import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { canTransition, garmentFamily, type OrderStatus } from '@tailonix/shared';
import { AuditService } from '../audit/audit.service';
import { CounterService } from '../common/counter.service';
import { ReservationService } from '../inventory/reservation.service';
import {
  BISHT_HEM_ALLOWANCE_METERS,
  HEM_ALLOWANCE_METERS,
  SHIRT_HEM_ALLOWANCE_METERS,
  TROUSERS_HEM_ALLOWANCE_METERS,
  YieldService,
} from '../inventory/yield.service';
import { InvoicesService } from '../invoices/invoices.service';
import { LedgerService } from '../ledger/ledger.service';
import { OrderEventsPublisher } from '../orders/order-events.publisher';
import { PrismaService } from '../prisma/prisma.service';
import { WorkshopService } from '../workshop/workshop.service';
import type { PosCheckoutDto } from './dto/pos.dto';

/**
 * Per-type robe-family yield parameters (D-054). Thobe's are the blueprint's
 * exact figures; Bisht/Shirt are approximations pending real shop figures —
 * see yield.service.ts for the rationale behind each allowance.
 */
const ROBE_YIELD_PARAMS: Record<string, { lengthMultiplier: number; hemAllowanceM: Prisma.Decimal }> = {
  Thobe: { lengthMultiplier: 2, hemAllowanceM: HEM_ALLOWANCE_METERS },
  Bisht: { lengthMultiplier: 2, hemAllowanceM: BISHT_HEM_ALLOWANCE_METERS },
  Shirt: { lengthMultiplier: 1, hemAllowanceM: SHIRT_HEM_ALLOWANCE_METERS },
};

/**
 * Front-of-house checkout (v4 Phases 1–4). One call performs the whole counter
 * transaction, because the steps are not independently useful — a reservation
 * without an order, or an order without tickets, is a broken state.
 *
 *   measurement → yield → stock validation → reserve → order + designs
 *   → deposit → ZATCA invoice → split production tickets
 */
@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly yieldService: YieldService,
    private readonly reservations: ReservationService,
    private readonly workshop: WorkshopService,
    private readonly invoices: InvoicesService,
    private readonly ledger: LedgerService,
    private readonly counters: CounterService,
    private readonly audit: AuditService,
    private readonly events: OrderEventsPublisher,
  ) {}

  /**
   * Shared by every "open a customer at the counter" path (phone, id, and the
   * directory picker), so the shape the front end renders never diverges
   * between them. `findFirst` rather than `findUnique` because it needs to
   * accept either a phone or an id predicate — both are already unique, so
   * this costs nothing over the compound-key lookup it replaces.
   */
  private async fullProfile(orgId: string, where: Prisma.CustomerWhereInput) {
    const customer = await this.prisma.customer.findFirst({
      where: { organizationId: orgId, ...where },
      include: {
        measurements: {
          where: { isActive: true },
          orderBy: { garmentType: 'asc' },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, orderNumber: true, status: true, totalAmount: true, createdAt: true },
        },
      },
    });
    if (!customer) return null;

    return {
      customer: {
        id: customer.id,
        fullName: customer.fullName,
        phone: customer.phone,
        language: customer.language,
        whatsappConsent: customer.whatsappConsent,
        lifetimeOrderCount: customer.lifetimeOrderCount,
        tier: this.tierFor(customer.lifetimeOrderCount),
      },
      activeMeasurements: customer.measurements,
      recentOrders: customer.orders,
    };
  }

  /** Phase 1 (legacy path): exact-phone lookup, e.g. a barcode-scanned loyalty card. */
  async lookupByPhone(orgId: string, phone: string) {
    const profile = await this.fullProfile(orgId, { phone });
    if (!profile) return { found: false as const, phone };
    return { found: true as const, ...profile };
  }

  /** Phase 1 (directory path): opening a customer picked from the search list. */
  async lookupById(orgId: string, customerId: string) {
    const profile = await this.fullProfile(orgId, { id: customerId });
    if (!profile) throw new NotFoundException('Customer not found in your organization');
    return { found: true as const, ...profile };
  }

  /**
   * Rush-hour customer picker (v4 §1 amendment). No query returns the most
   * recently active customers — in practice the walk-ins a cashier is most
   * likely to be serving again — so there is always something useful on
   * screen the instant Counter opens, before anyone has typed a digit.
   */
  async directory(orgId: string, search?: string) {
    const trimmed = search?.trim();
    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
        ...(trimmed
          ? {
              OR: [
                { fullName: { contains: trimmed, mode: 'insensitive' } },
                { phone: { contains: trimmed } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: trimmed ? 20 : 8,
      select: {
        id: true,
        fullName: true,
        phone: true,
        whatsappConsent: true,
        lifetimeOrderCount: true,
      },
    });
    return customers.map((c) => ({ ...c, tier: this.tierFor(c.lifetimeOrderCount) }));
  }

  /** Customer tier from lifetime garments (v4 §1). */
  private tierFor(count: number): 'new' | 'bronze' | 'silver' | 'gold' {
    if (count >= 50) return 'gold';
    if (count >= 20) return 'silver';
    if (count >= 5) return 'bronze';
    return 'new';
  }

  /**
   * Dispatches to the right yield formula for this garment's family (D-054).
   * Trousers has no sleeve/M1 concept at all — it needs its own required-field
   * check, not the robe family's M1+M3 one.
   */
  private computeYield(
    garmentType: string,
    measurement: {
      m1FrontLength: Prisma.Decimal | null;
      m1BackLength: Prisma.Decimal | null;
      m3SleeveLeft: Prisma.Decimal | null;
      m3SleeveRight: Prisma.Decimal | null;
      t4Outseam: Prisma.Decimal | null;
    },
    quantity: number,
  ): Prisma.Decimal {
    if (garmentFamily(garmentType) === 'trousers') {
      if (!measurement.t4Outseam) {
        throw new BadRequestException('Active profile is missing T4 (outseam)');
      }
      return this.yieldService.calculateTrousers({
        outseamCm: measurement.t4Outseam,
        quantity,
        hemAllowanceM: TROUSERS_HEM_ALLOWANCE_METERS,
      });
    }
    if (!measurement.m1FrontLength || !measurement.m1BackLength || !measurement.m3SleeveLeft || !measurement.m3SleeveRight) {
      throw new BadRequestException(
        'Active profile is missing M1 (front/back length) or M3 (left/right sleeve)',
      );
    }
    // D-068: cut to the longer side of each pair — never short a fabric cut
    // for an asymmetric body or a robe whose front and back panels differ.
    const totalLengthCm = Prisma.Decimal.max(measurement.m1FrontLength, measurement.m1BackLength);
    const sleeveLengthCm = Prisma.Decimal.max(measurement.m3SleeveLeft, measurement.m3SleeveRight);
    const { lengthMultiplier, hemAllowanceM } = ROBE_YIELD_PARAMS[garmentType] ?? ROBE_YIELD_PARAMS.Thobe;
    return this.yieldService.calculateRobe({
      totalLengthCm,
      sleeveLengthCm,
      quantity,
      lengthMultiplier,
      hemAllowanceM,
    });
  }

  /** Phase 2 preview: what a garment will cost in fabric, before committing. */
  async previewYield(customerId: string, garmentType: string, quantity = 1) {
    const measurement = await this.prisma.measurement.findFirst({
      where: { customerId, garmentType, isActive: true },
    });
    if (!measurement) {
      throw new BadRequestException(
        `No active measurement profile for ${garmentType} — take measurements first`,
      );
    }
    const perGarment = this.computeYield(garmentType, measurement, 1);
    const totalMeters = this.computeYield(garmentType, measurement, quantity);
    return {
      measurementId: measurement.id,
      version: measurement.version,
      perGarment: perGarment.toFixed(2),
      totalMeters: totalMeters.toFixed(2),
      quantity,
    };
  }

  /**
   * The counter transaction. Everything happens in one database transaction so
   * a stock failure on garment 3 cannot leave garments 1–2 reserved.
   */
  async checkout(orgId: string, storeId: string, userId: string, dto: PosCheckoutDto, ip?: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId: orgId },
    });
    if (!customer) throw new NotFoundException('Customer not found in your organization');
    if (dto.items.length === 0) throw new BadRequestException('At least one garment is required');

    // Resolve measurements and yields up front so we fail before writing anything.
    const prepared: {
      item: PosCheckoutDto['items'][number];
      measurement: {
        id: string;
        m1FrontLength: Prisma.Decimal | null;
        m1BackLength: Prisma.Decimal | null;
        m3SleeveLeft: Prisma.Decimal | null;
        m3SleeveRight: Prisma.Decimal | null;
        t4Outseam: Prisma.Decimal | null;
      };
      yieldMeters: Prisma.Decimal;
    }[] = [];
    for (const [index, item] of dto.items.entries()) {
      const measurement = await this.prisma.measurement.findFirst({
        where: { customerId: dto.customerId, garmentType: item.garmentType, isActive: true },
      });
      if (!measurement) {
        throw new BadRequestException(
          `Garment ${index + 1} (${item.garmentType}): no active measurement profile`,
        );
      }
      let yieldMeters: Prisma.Decimal;
      try {
        yieldMeters = this.computeYield(item.garmentType, measurement, item.quantity ?? 1);
      } catch (err) {
        throw new BadRequestException(
          `Garment ${index + 1} (${item.garmentType}): ${(err as Error).message}`,
        );
      }
      prepared.push({ item, measurement, yieldMeters });
    }

    const order = await this.prisma.$transaction(async (tx) => {
      // Atomic — count(*)+1 collides when two tills check out together (D-038)
      const seq = await this.counters.next(tx, {
        organizationId: orgId,
        storeId,
        kind: 'order',
      });
      const orderNumber = `ORD-${String(seq).padStart(6, '0')}`;

      const total = prepared.reduce(
        (sum, p) => sum.add(new Prisma.Decimal(p.item.unitPrice).mul(p.item.quantity ?? 1)),
        new Prisma.Decimal(0),
      );

      const created = await tx.order.create({
        data: {
          organizationId: orgId,
          storeId,
          customerId: dto.customerId,
          orderNumber,
          totalAmount: total.minus(dto.discountAmount ?? 0),
          discountAmount: dto.discountAmount ?? 0,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          notes: dto.notes,
          isUrgent: dto.isUrgent ?? false,
          createdById: userId,
        },
      });

      for (const [index, p] of prepared.entries()) {
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: created.id,
            garmentType: p.item.garmentType,
            description: p.item.description,
            quantity: p.item.quantity ?? 1,
            unitPrice: p.item.unitPrice,
            measurementId: p.measurement.id,
            sequenceNo: index + 1,
            collarStyle: p.item.collarStyle,
            cuffStyle: p.item.cuffStyle,
            pocketStyle: p.item.pocketStyle,
            stitchingStyle: p.item.stitchingStyle,
            cutStyle: p.item.cutStyle,
            cufflinkSize: p.item.cufflinkSize,
            yieldMeters: p.yieldMeters,
          },
        });

        // Hold the fabric — validated against the roll's minimum usable point.
        // Skipped entirely when the customer brought their own material: no
        // batch to reserve against, and yieldMeters (already stored above)
        // stays on the order item as the fabric estimate either way.
        if (p.item.fabricBatchId) {
          await this.reservations.reserve(tx, {
            batchId: p.item.fabricBatchId,
            orderItemId: orderItem.id,
            meters: p.yieldMeters,
            storeId,
            userId,
          });
        }
      }

      let withDeposit = created;
      if (dto.depositAmount && dto.depositAmount > 0) {
        await tx.payment.create({
          data: {
            orderId: created.id,
            amount: dto.depositAmount,
            method: dto.depositMethod ?? 'card',
            kind: 'deposit', // liability until handover (v4 Phase 3 §2)
            receivedById: userId,
          },
        });
        // Capture the updated row — `created` was read before this write, and
        // returning it would print a receipt showing the full amount still due.
        withDeposit = await tx.order.update({
          where: { id: created.id },
          data: { paidAmount: dto.depositAmount },
        });

        // A deposit is a liability, not revenue — nothing is earned until the
        // customer collects (v4 Phase 3 §2, D-036).
        await this.ledger.postDeposit(tx, {
          organizationId: orgId,
          storeId,
          orderId: created.id,
          orderNumber: created.orderNumber,
          amount: dto.depositAmount,
          method: dto.depositMethod ?? 'card',
          postedById: userId,
        });
      }

      await tx.orderStatusHistory.create({
        data: { orderId: created.id, toStatus: 'pending', changedById: userId },
      });
      await tx.customer.update({
        where: { id: dto.customerId },
        data: { lifetimeOrderCount: { increment: prepared.length } },
      });
      await tx.customerStoreVisit.upsert({
        where: { customerId_storeId: { customerId: dto.customerId, storeId } },
        update: { lastVisitDate: new Date() },
        create: { customerId: dto.customerId, storeId },
      });
      return withDeposit;
    });

    // Post-commit: tickets and the tax document. Deliberately outside the
    // transaction — an invoice-numbering hiccup must not roll back a paid order.
    const tickets = await this.workshop.createTicketsForOrder(order.id, userId);

    let invoice = null;
    let invoiceError: string | null = null;
    try {
      // createForOrder issues to ZATCA before rendering, so this returns a
      // fully-formed tax invoice — VAT split, hash chain slot, and QR included.
      invoice = await this.invoices.createForOrder(order.id, userId);
    } catch (err) {
      // A missing tax invoice is a compliance problem, not a log line — the
      // counter must know before handing goods over.
      invoiceError = (err as Error).message || 'ZATCA issuance failed';
      this.logger.error(`ZATCA issuance failed for ${order.orderNumber}: ${invoiceError}`);
    }

    await this.audit.log({
      organizationId: orgId,
      storeId,
      actorUserId: userId,
      action: 'pos.checkout',
      entityType: 'order',
      entityId: order.id,
      newValue: {
        orderNumber: order.orderNumber,
        garments: prepared.length,
        deposit: dto.depositAmount ?? 0,
      },
      ip,
    });

    const totalReserved = prepared.reduce(
      (sum, p) => sum.add(p.yieldMeters),
      new Prisma.Decimal(0),
    );

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      customerName: customer.fullName,
      dueDate: order.dueDate,
      isUrgent: order.isUrgent,
      totalAmount: order.totalAmount.toFixed(2),
      paidAmount: order.paidAmount.toFixed(2),
      balanceDue: order.totalAmount.minus(order.paidAmount).toFixed(2),
      totalReservedMeters: totalReserved.toFixed(2),
      // Zipped with `prepared` by index rather than re-queried: createTicketsForOrder
      // creates one ticket per order.item in sequenceNo order, and order.items were
      // created by iterating `prepared` in that same order, so index i is the same
      // garment in both arrays. Carrying garmentType here is what lets Receipt print
      // a garment tag per ticket without a second round trip.
      tickets: tickets.map((t, i) => ({
        id: t.id,
        ticketCode: t.ticketCode,
        station: t.station,
        garmentType: prepared[i]?.item.garmentType ?? t.orderItemId,
      })),
      invoiceError,
      invoice: invoice && {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        icv: invoice.icv,
        netAmount: invoice.netAmount?.toFixed(2),
        vatAmount: invoice.vatAmount?.toFixed(2),
        totalAmount: invoice.totalAmount.toFixed(2),
        qrCodeBase64: invoice.qrCodeBase64,
      },
    };
  }

  /** Phase 5 §3: final settlement moves the deposit into realised revenue. */
  async settle(storeId: string, orderId: string, userId: string, amount: number, method?: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException('Order not found in this store');

    const paid = new Prisma.Decimal(order.paidAmount);
    const balance = new Prisma.Decimal(order.totalAmount).minus(paid);
    const payment = new Prisma.Decimal(amount);
    if (payment.greaterThan(balance)) {
      throw new BadRequestException(
        `Payment ${payment.toFixed(2)} exceeds the outstanding balance ${balance.toFixed(2)}`,
      );
    }

    const deposits = order.payments
      .filter((p) => p.kind === 'deposit')
      .reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));

    // Only release the deposit from liability once, on the payment that closes
    // the order — a partial settlement leaves it held.
    const closesOrder = balance.minus(payment).isZero();

    // Paying off the balance at the counter *is* the handover — a cashier who
    // just collected the last riyal shouldn't need a separate manager trip to
    // Workshop to mark the order delivered (D-051). This never blocks the
    // payment itself: if production hasn't reached 'ready' yet the money is
    // still recorded, the order just isn't auto-closed, and the response says
    // so via `markedDelivered` so the counter can flag it for follow-up.
    const willDeliver = closesOrder && canTransition(order.status as OrderStatus, 'delivered');

    const created = await this.prisma.$transaction(async (tx) => {
      const receipt = await tx.payment.create({
        data: {
          orderId,
          amount: payment,
          method: (method as never) ?? 'cash',
          kind: 'settlement',
          receivedById: userId,
        },
      });
      await tx.order.update({
        where: { id: orderId },
        data: {
          paidAmount: paid.plus(payment),
          ...(willDeliver ? { status: 'delivered', deliveredAt: new Date() } : {}),
        },
      });
      if (willDeliver) {
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: order.status,
            toStatus: 'delivered',
            note: 'Closed out at final settlement',
            changedById: userId,
          },
        });
      }
      await this.ledger.postSettlement(tx, {
        organizationId: order.organizationId,
        storeId,
        orderId,
        orderNumber: order.orderNumber,
        amount: payment,
        depositApplied: closesOrder ? deposits : 0,
        orderTotal: order.totalAmount,
        method: method ?? 'cash',
        postedById: userId,
      });
      return receipt;
    });

    await this.audit.log({
      storeId,
      actorUserId: userId,
      action: 'pos.settled',
      entityType: 'order',
      entityId: orderId,
      newValue: {
        amount: payment.toFixed(2),
        depositReleasedFromLiability: deposits.toFixed(2),
        markedDelivered: willDeliver,
      },
    });

    if (willDeliver) {
      await this.events.publishStatusChanged({
        orderId,
        organizationId: order.organizationId,
        storeId,
        customerId: order.customerId,
        orderNumber: order.orderNumber,
        fromStatus: order.status,
        toStatus: 'delivered',
      });
    }

    return {
      paymentId: created.id,
      paidTotal: paid.plus(payment).toFixed(2),
      balanceDue: balance.minus(payment).toFixed(2),
      depositRealised: deposits.toFixed(2),
      status: willDeliver ? 'delivered' : order.status,
      markedDelivered: willDeliver,
    };
  }
}
