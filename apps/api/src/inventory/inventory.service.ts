import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AdjustBatchDto, CreateBatchDto, TransferDto } from './dto/inventory.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Log a fabric purchase: creates the batch and its purchase_in movement (I-1). */
  async createBatch(storeId: string, userId: string, dto: CreateBatchDto, ip?: string) {
    const quantity = new Prisma.Decimal(dto.quantity);
    const batch = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryBatch.create({
        data: {
          storeId,
          supplierId: dto.supplierId,
          fabricName: dto.fabricName,
          fabricCode: dto.fabricCode,
          batchCode: dto.batchCode,
          color: dto.color,
          unit: dto.unit ?? 'meter',
          initialQuantity: quantity,
          currentQuantity: quantity,
          costPricePerUnit: dto.costPricePerUnit,
          sellingPricePerUnit: dto.sellingPricePerUnit,
          purchaseDate: new Date(dto.purchaseDate),
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          storageLocation: dto.storageLocation,
        },
      });
      await tx.inventoryMovement.create({
        data: {
          batchId: created.id,
          movementType: 'purchase_in',
          quantity,
          previousBalance: 0,
          newBalance: quantity,
          createdById: userId,
        },
      });
      return created;
    });

    await this.audit.log({
      storeId,
      actorUserId: userId,
      action: 'inventory.batch_created',
      entityType: 'inventory_batch',
      entityId: batch.id,
      newValue: { batchCode: batch.batchCode, fabricName: batch.fabricName, quantity: dto.quantity },
      ip,
    });
    return batch;
  }

  async listBatches(
    storeId: string,
    query: { search?: string; fabricName?: string; status?: string; page?: number; pageSize?: number },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const where: Prisma.InventoryBatchWhereInput = {
      storeId,
      ...(query.fabricName ? { fabricName: query.fabricName } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { fabricName: { contains: query.search, mode: 'insensitive' } },
              { batchCode: { contains: query.search, mode: 'insensitive' } },
              { fabricCode: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryBatch.findMany({
        where,
        orderBy: [{ fabricName: 'asc' }, { purchaseDate: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { supplier: { select: { id: true, name: true } } },
      }),
      this.prisma.inventoryBatch.count({ where }),
    ]);
    return { items, meta: { page, pageSize, total } };
  }

  async getBatch(storeId: string, batchId: string) {
    const batch = await this.prisma.inventoryBatch.findFirst({
      where: { id: batchId, storeId },
      include: { supplier: { select: { id: true, name: true } } },
    });
    if (!batch) throw new NotFoundException('Batch not found in this store');
    return batch;
  }

  /** Complete movement history for a batch (I-3). */
  async getMovements(storeId: string, batchId: string, page = 1, pageSize = 50) {
    await this.getBatch(storeId, batchId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inventoryMovement.findMany({
        where: { batchId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          createdBy: { select: { id: true, fullName: true } },
          order: { select: { id: true, orderNumber: true } },
        },
      }),
      this.prisma.inventoryMovement.count({ where: { batchId } }),
    ]);
    return { items, meta: { page, pageSize, total } };
  }

  /** Manual quantity adjustment with mandatory note (append-only ledger). */
  async adjustBatch(storeId: string, userId: string, batchId: string, dto: AdjustBatchDto, ip?: string) {
    if (dto.delta === 0) throw new BadRequestException('Delta must be non-zero');
    const delta = new Prisma.Decimal(dto.delta);

    const result = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; current_quantity: Prisma.Decimal }[]>`
        SELECT id, current_quantity FROM inventory_batches
        WHERE id = ${batchId}::uuid AND store_id = ${storeId}::uuid
        FOR UPDATE
      `;
      const batch = rows[0];
      if (!batch) throw new NotFoundException('Batch not found in this store');

      const newBalance = new Prisma.Decimal(batch.current_quantity).add(delta);
      if (newBalance.isNegative()) {
        throw new BadRequestException(
          `Adjustment would make stock negative (current: ${batch.current_quantity})`,
        );
      }
      const updated = await tx.inventoryBatch.update({
        where: { id: batchId },
        data: {
          currentQuantity: newBalance,
          status: newBalance.isZero() ? 'depleted' : 'available',
        },
      });
      await tx.inventoryMovement.create({
        data: {
          batchId,
          movementType: 'adjustment',
          quantity: delta.abs(),
          previousBalance: batch.current_quantity,
          newBalance,
          note: dto.note,
          createdById: userId,
        },
      });
      return updated;
    });

    await this.audit.log({
      storeId,
      actorUserId: userId,
      action: 'inventory.batch_adjusted',
      entityType: 'inventory_batch',
      entityId: batchId,
      newValue: { delta: dto.delta, note: dto.note },
      ip,
    });
    return result;
  }

  /**
   * Inter-store transfer (TRD §5.2): same-org validation, transfer_out at source,
   * transfer_in at destination (merging into an existing same-code batch if present).
   */
  async transfer(orgId: string, userId: string, dto: TransferDto, ip?: string) {
    const quantity = new Prisma.Decimal(dto.quantity);

    const result = await this.prisma.$transaction(async (tx) => {
      const srcRows = await tx.$queryRaw<
        {
          id: string;
          store_id: string;
          batch_code: string;
          fabric_name: string;
          fabric_code: string | null;
          color: string | null;
          unit: string;
          current_quantity: Prisma.Decimal;
          cost_price_per_unit: Prisma.Decimal;
          selling_price_per_unit: Prisma.Decimal | null;
          supplier_id: string | null;
          purchase_date: Date;
        }[]
      >`
        SELECT b.id, b.store_id, b.batch_code, b.fabric_name, b.fabric_code, b.color, b.unit,
               b.current_quantity, b.cost_price_per_unit, b.selling_price_per_unit,
               b.supplier_id, b.purchase_date
        FROM inventory_batches b
        JOIN stores s ON s.id = b.store_id
        WHERE b.id = ${dto.batchId}::uuid AND s.organization_id = ${orgId}::uuid
        FOR UPDATE OF b
      `;
      const source = srcRows[0];
      if (!source) throw new NotFoundException('Source batch not found in your organization');

      const destStore = await tx.store.findFirst({
        where: { id: dto.destinationStoreId, organizationId: orgId },
        select: { id: true, name: true },
      });
      if (!destStore) {
        throw new BadRequestException('Destination store is not in your organization');
      }
      if (destStore.id === source.store_id) {
        throw new BadRequestException('Source and destination stores are the same');
      }
      if (new Prisma.Decimal(source.current_quantity).lessThan(quantity)) {
        throw new BadRequestException(
          `Insufficient quantity (available: ${source.current_quantity})`,
        );
      }

      // Source: decrement + transfer_out
      const srcNewBalance = new Prisma.Decimal(source.current_quantity).sub(quantity);
      await tx.inventoryBatch.update({
        where: { id: source.id },
        data: {
          currentQuantity: srcNewBalance,
          ...(srcNewBalance.isZero() ? { status: 'depleted' } : {}),
        },
      });
      await tx.inventoryMovement.create({
        data: {
          batchId: source.id,
          movementType: 'transfer_out',
          quantity,
          previousBalance: source.current_quantity,
          newBalance: srcNewBalance,
          note: dto.note,
          referenceDocument: `transfer→${destStore.name}`,
          createdById: userId,
        },
      });

      // Destination: merge or create (D-002 makes same-code-per-store possible)
      const existing = await tx.inventoryBatch.findUnique({
        where: {
          storeId_batchCode: { storeId: destStore.id, batchCode: source.batch_code },
        },
      });
      let destBatchId: string;
      if (existing) {
        const destNewBalance = new Prisma.Decimal(existing.currentQuantity).add(quantity);
        await tx.inventoryBatch.update({
          where: { id: existing.id },
          data: { currentQuantity: destNewBalance, status: 'available' },
        });
        await tx.inventoryMovement.create({
          data: {
            batchId: existing.id,
            movementType: 'transfer_in',
            quantity,
            previousBalance: existing.currentQuantity,
            newBalance: destNewBalance,
            note: dto.note,
            referenceDocument: `transfer←${source.store_id}`,
            createdById: userId,
          },
        });
        destBatchId = existing.id;
      } else {
        const created = await tx.inventoryBatch.create({
          data: {
            storeId: destStore.id,
            supplierId: source.supplier_id,
            fabricName: source.fabric_name,
            fabricCode: source.fabric_code,
            batchCode: source.batch_code,
            color: source.color,
            unit: source.unit,
            initialQuantity: quantity,
            currentQuantity: quantity,
            costPricePerUnit: source.cost_price_per_unit,
            sellingPricePerUnit: source.selling_price_per_unit,
            // preserve original purchase date so FIFO ordering stays truthful
            purchaseDate: source.purchase_date,
          },
        });
        await tx.inventoryMovement.create({
          data: {
            batchId: created.id,
            movementType: 'transfer_in',
            quantity,
            previousBalance: 0,
            newBalance: quantity,
            note: dto.note,
            referenceDocument: `transfer←${source.store_id}`,
            createdById: userId,
          },
        });
        destBatchId = created.id;
      }
      return { sourceBatchId: source.id, destBatchId, sourceStoreId: source.store_id };
    });

    await this.audit.log({
      organizationId: orgId,
      storeId: result.sourceStoreId,
      actorUserId: userId,
      action: 'inventory.transferred',
      entityType: 'inventory_batch',
      entityId: dto.batchId,
      newValue: {
        destinationStoreId: dto.destinationStoreId,
        destBatchId: result.destBatchId,
        quantity: dto.quantity,
      },
      ip,
    });
    return result;
  }
}
