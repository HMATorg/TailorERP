import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { YieldService } from './yield.service';

/**
 * Fabric reservations (v4 Phase 2 §3).
 *
 * Checkout *reserves* metres; the cutting station *consumes* them. Reserving
 * rather than deducting is what stops a walk-in sale from eating fabric already
 * promised to a production order — the blueprint's "Inventory Hold".
 */
@Injectable()
export class ReservationService {
  private readonly logger = new Logger(ReservationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly yieldService: YieldService,
  ) {}

  /**
   * Holds `meters` on a roll for an order item. Runs inside the caller's
   * transaction and locks the batch row, so two concurrent checkouts cannot
   * both pass the availability check against the same remainder.
   */
  async reserve(
    tx: Prisma.TransactionClient,
    params: {
      batchId: string;
      orderItemId: string;
      meters: Prisma.Decimal | number;
      storeId: string;
      userId?: string;
    },
  ) {
    const rows = await tx.$queryRaw<
      {
        id: string;
        batch_code: string;
        fabric_name: string;
        current_quantity: Prisma.Decimal;
        reserved_quantity: Prisma.Decimal;
        min_usable_meters: Prisma.Decimal;
      }[]
    >`
      SELECT id, batch_code, fabric_name, current_quantity, reserved_quantity, min_usable_meters
      FROM inventory_batches
      WHERE id = ${params.batchId}::uuid AND store_id = ${params.storeId}::uuid
        AND status = 'available'
      FOR UPDATE
    `;
    const batch = rows[0];
    if (!batch) {
      throw new NotFoundException('Fabric roll not available in this store');
    }

    const required = new Prisma.Decimal(params.meters);
    const check = this.yieldService.canCutFrom({
      currentQuantity: batch.current_quantity,
      reservedQuantity: batch.reserved_quantity,
      minUsableMeters: batch.min_usable_meters,
      requiredMeters: required,
    });

    if (!check.ok) {
      throw new UnprocessableEntityException({
        message: `Roll ${batch.batch_code} cannot supply ${required.toFixed(2)}m and stay above its ${check.minUsable.toFixed(2)}m minimum`,
        batchCode: batch.batch_code,
        fabricName: batch.fabric_name,
        required: required.toFixed(2),
        available: check.available.toFixed(2),
        remainderAfter: check.remainderAfter.toFixed(2),
        minUsable: check.minUsable.toFixed(2),
      });
    }

    await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: { reservedQuantity: new Prisma.Decimal(batch.reserved_quantity).plus(required) },
    });

    return tx.fabricReservation.create({
      data: {
        batchId: batch.id,
        orderItemId: params.orderItemId,
        meters: required,
        reservedById: params.userId,
      },
    });
  }

  /**
   * Cutting stage: the reserved metres physically leave the roll.
   * Releases the hold and writes the movement in the same transaction.
   */
  async consumeForOrderItem(orderItemId: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservations = await tx.fabricReservation.findMany({
        where: { orderItemId, status: 'reserved' },
      });
      if (reservations.length === 0) return { consumed: 0 };

      for (const reservation of reservations) {
        const rows = await tx.$queryRaw<
          { current_quantity: Prisma.Decimal; reserved_quantity: Prisma.Decimal }[]
        >`
          SELECT current_quantity, reserved_quantity FROM inventory_batches
          WHERE id = ${reservation.batchId}::uuid
          FOR UPDATE
        `;
        const batch = rows[0];
        if (!batch) continue;

        const previous = new Prisma.Decimal(batch.current_quantity);
        const newBalance = previous.minus(reservation.meters);
        const newReserved = Prisma.Decimal.max(
          new Prisma.Decimal(batch.reserved_quantity).minus(reservation.meters),
          new Prisma.Decimal(0),
        );

        await tx.inventoryBatch.update({
          where: { id: reservation.batchId },
          data: {
            currentQuantity: newBalance,
            reservedQuantity: newReserved,
            ...(newBalance.isZero() ? { status: 'depleted' as const } : {}),
          },
        });
        await tx.inventoryMovement.create({
          data: {
            batchId: reservation.batchId,
            movementType: 'order_out',
            quantity: reservation.meters,
            previousBalance: previous,
            newBalance,
            referenceDocument: 'cutting',
            createdById: userId,
          },
        });
        await tx.fabricReservation.update({
          where: { id: reservation.id },
          data: { status: 'consumed', consumedAt: new Date() },
        });
      }
      return { consumed: reservations.length };
    });
  }

  /** Cancellation: metres go back to the sellable pool. */
  async releaseForOrder(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const reservations = await tx.fabricReservation.findMany({
        where: { orderItem: { orderId }, status: 'reserved' },
      });
      for (const reservation of reservations) {
        await tx.inventoryBatch.update({
          where: { id: reservation.batchId },
          data: { reservedQuantity: { decrement: reservation.meters } },
        });
        await tx.fabricReservation.update({
          where: { id: reservation.id },
          data: { status: 'released', releasedAt: new Date() },
        });
      }
      this.logger.log(`Released ${reservations.length} reservation(s) for order ${orderId}`);
      return { released: reservations.length };
    });
  }

  /**
   * Rolls a clerk may offer for an adult thobe: available metres must leave the
   * roll above its minimum usable point after the cut.
   */
  async sellableRolls(storeId: string, requiredMeters: number, fabricName?: string) {
    const batches = await this.prisma.inventoryBatch.findMany({
      where: {
        storeId,
        status: 'available',
        ...(fabricName ? { fabricName } : {}),
      },
      orderBy: [{ fabricName: 'asc' }, { purchaseDate: 'asc' }],
    });

    return batches
      .map((batch) => {
        const check = this.yieldService.canCutFrom({
          currentQuantity: batch.currentQuantity,
          reservedQuantity: batch.reservedQuantity,
          minUsableMeters: batch.minUsableMeters,
          requiredMeters,
        });
        return {
          id: batch.id,
          batchCode: batch.batchCode,
          barcode: batch.barcode,
          fabricName: batch.fabricName,
          brand: batch.brand,
          origin: batch.origin,
          colorShadeCode: batch.colorShadeCode,
          color: batch.color,
          currentQuantity: batch.currentQuantity.toFixed(2),
          reservedQuantity: batch.reservedQuantity.toFixed(2),
          available: check.available.toFixed(2),
          remainderAfter: check.remainderAfter.toFixed(2),
          minUsable: check.minUsable.toFixed(2),
          sellable: check.ok,
        };
      })
      .filter((row) => row.sellable);
  }
}
