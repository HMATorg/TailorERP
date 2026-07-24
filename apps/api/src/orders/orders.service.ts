import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canTransition, type OrderStatus } from '@tailonix/shared';
import { AuditService } from '../audit/audit.service';
import { FifoService } from '../inventory/fifo.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrderEventsPublisher } from './order-events.publisher';
import type {
  AddPaymentDto,
  CreateOrderDto,
  ExplicitBatchAllocationDto,
  UpdateOrderStatusDto,
} from './dto/orders.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fifo: FifoService,
    private readonly audit: AuditService,
    private readonly events: OrderEventsPublisher,
  ) {}

  /** Sequential per-store order number, e.g. ORD-000042 (D-010). */
  private async nextOrderNumber(tx: Prisma.TransactionClient, storeId: string): Promise<string> {
    const count = await tx.order.count({ where: { storeId } });
    return `ORD-${String(count + 1).padStart(6, '0')}`;
  }

  /** Explicit batch allocation path (wireframes §3.3): lock, validate, consume. */
  private async consumeExplicit(
    tx: Prisma.TransactionClient,
    storeId: string,
    allocations: ExplicitBatchAllocationDto[],
    orderId: string,
    userId: string,
  ) {
    const results: { batchId: string; quantity: Prisma.Decimal; costPerUnit: Prisma.Decimal }[] = [];
    for (const alloc of allocations) {
      const rows = await tx.$queryRaw<
        { id: string; current_quantity: Prisma.Decimal; cost_price_per_unit: Prisma.Decimal }[]
      >`
        SELECT id, current_quantity, cost_price_per_unit FROM inventory_batches
        WHERE id = ${alloc.batchId}::uuid AND store_id = ${storeId}::uuid AND status = 'available'
        FOR UPDATE
      `;
      const batch = rows[0];
      if (!batch) {
        throw new UnprocessableEntityException(`Batch ${alloc.batchId} not available in this store`);
      }
      const take = new Prisma.Decimal(alloc.quantity);
      const balance = new Prisma.Decimal(batch.current_quantity);
      if (balance.lessThan(take)) {
        throw new UnprocessableEntityException({
          message: 'Insufficient stock in selected batch',
          batchId: alloc.batchId,
          required: take.toString(),
          available: balance.toString(),
        });
      }
      const newBalance = balance.sub(take);
      await tx.inventoryBatch.update({
        where: { id: alloc.batchId },
        data: {
          currentQuantity: newBalance,
          ...(newBalance.isZero() ? { status: 'depleted' } : {}),
        },
      });
      await tx.inventoryMovement.create({
        data: {
          batchId: alloc.batchId,
          orderId,
          movementType: 'order_out',
          quantity: take,
          previousBalance: balance,
          newBalance,
          createdById: userId,
        },
      });
      results.push({
        batchId: alloc.batchId,
        quantity: take,
        costPerUnit: new Prisma.Decimal(batch.cost_price_per_unit),
      });
    }
    return results;
  }

  async create(
    orgId: string,
    storeId: string,
    userId: string,
    dto: CreateOrderDto,
    ip?: string,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId: orgId },
    });
    if (!customer) throw new BadRequestException('Customer not found in your organization');

    const order = await this.prisma.$transaction(async (tx) => {
      const orderNumber = await this.nextOrderNumber(tx, storeId);
      const totalAmount = dto.items.reduce(
        (sum, i) => sum.add(new Prisma.Decimal(i.unitPrice).mul(i.quantity ?? 1)),
        new Prisma.Decimal(0),
      );

      const created = await tx.order.create({
        data: {
          organizationId: orgId,
          storeId,
          customerId: dto.customerId,
          orderNumber,
          totalAmount: totalAmount.sub(dto.discountAmount ?? 0),
          discountAmount: dto.discountAmount ?? 0,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          notes: dto.notes,
          createdById: userId,
        },
      });

      for (const item of dto.items) {
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: created.id,
            garmentType: item.garmentType,
            description: item.description,
            quantity: item.quantity ?? 1,
            unitPrice: item.unitPrice,
            measurementId: item.measurementId,
          },
        });

        for (const fabric of item.fabrics ?? []) {
          const consumed = fabric.batchAllocations?.length
            ? await this.consumeExplicit(
                tx,
                storeId,
                fabric.batchAllocations,
                created.id,
                userId,
              )
            : await this.fifo.consume(tx, {
                storeId,
                fabricName: fabric.fabricName,
                quantity: fabric.quantity,
                orderId: created.id,
                userId,
                referenceDocument: orderNumber,
              });

          await tx.orderItemFabric.createMany({
            data: consumed.map((c) => ({
              orderItemId: orderItem.id,
              batchId: c.batchId,
              quantityUsed: c.quantity,
              costPerUnitAtUse: c.costPerUnit,
            })),
          });
        }
      }

      await tx.orderStatusHistory.create({
        data: { orderId: created.id, toStatus: 'pending', changedById: userId },
      });
      await tx.customerStoreVisit.upsert({
        where: { customerId_storeId: { customerId: dto.customerId, storeId } },
        update: { lastVisitDate: new Date() },
        create: { customerId: dto.customerId, storeId },
      });
      return created;
    });

    await this.audit.log({
      organizationId: orgId,
      storeId,
      actorUserId: userId,
      action: 'order.created',
      entityType: 'order',
      entityId: order.id,
      newValue: { orderNumber: order.orderNumber, total: order.totalAmount },
      ip,
    });
    return this.getById(storeId, order.id);
  }

  async list(
    storeId: string,
    query: { status?: string; customerId?: string; search?: string; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.OrderWhereInput = {
      storeId,
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.search
        ? {
            OR: [
              { orderNumber: { contains: query.search, mode: 'insensitive' } },
              { customer: { fullName: { contains: query.search, mode: 'insensitive' } } },
              { customer: { phone: { contains: query.search } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, fullName: true, phone: true } },
          items: { select: { id: true, garmentType: true, quantity: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total } };
  }

  async getById(storeId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: {
        customer: { select: { id: true, fullName: true, phone: true, whatsappConsent: true } },
        items: {
          include: {
            fabrics: {
              include: {
                batch: { select: { id: true, batchCode: true, fabricName: true, color: true } },
              },
            },
            measurement: { select: { id: true, garmentType: true, data: true } },
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          include: { changedBy: { select: { id: true, fullName: true } } },
        },
        payments: { orderBy: { createdAt: 'asc' } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found in this store');
    return order;
  }

  async updateStatus(
    orgId: string,
    storeId: string,
    userId: string,
    orderId: string,
    dto: UpdateOrderStatusDto,
    ip?: string,
  ) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, storeId } });
    if (!order) throw new NotFoundException('Order not found in this store');

    if (!canTransition(order.status as OrderStatus, dto.status)) {
      throw new BadRequestException(
        `Cannot transition from '${order.status}' to '${dto.status}'`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.update({
        where: { id: orderId },
        data: {
          status: dto.status,
          ...(dto.status === 'delivered' ? { deliveredAt: new Date() } : {}),
        },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: order.status,
          toStatus: dto.status,
          note: dto.note,
          changedById: userId,
        },
      });
      return result;
    });

    await this.audit.log({
      organizationId: orgId,
      storeId,
      actorUserId: userId,
      action: 'order.status_changed',
      entityType: 'order',
      entityId: orderId,
      oldValue: { status: order.status },
      newValue: { status: dto.status },
      ip,
    });
    await this.events.publishStatusChanged({
      orderId,
      organizationId: orgId,
      storeId,
      customerId: order.customerId,
      orderNumber: order.orderNumber,
      fromStatus: order.status,
      toStatus: dto.status,
    });
    return updated;
  }

  async addPayment(
    storeId: string,
    userId: string,
    orderId: string,
    dto: AddPaymentDto,
    ip?: string,
  ) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, storeId } });
    if (!order) throw new NotFoundException('Order not found in this store');

    const amount = new Prisma.Decimal(dto.amount);
    const newPaid = new Prisma.Decimal(order.paidAmount).add(amount);
    if (newPaid.greaterThan(order.totalAmount)) {
      throw new BadRequestException(
        `Payment exceeds balance (total: ${order.totalAmount}, already paid: ${order.paidAmount})`,
      );
    }

    const [payment] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          orderId,
          amount,
          method: dto.method ?? 'cash',
          reference: dto.reference,
          receivedById: userId,
        },
      }),
      this.prisma.order.update({ where: { id: orderId }, data: { paidAmount: newPaid } }),
    ]);

    await this.audit.log({
      storeId,
      actorUserId: userId,
      action: 'order.payment_received',
      entityType: 'order',
      entityId: orderId,
      newValue: { amount: dto.amount, method: dto.method ?? 'cash' },
      ip,
    });
    return payment;
  }
}
