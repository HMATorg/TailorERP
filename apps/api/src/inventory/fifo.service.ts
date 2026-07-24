import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface FifoConsumption {
  batchId: string;
  batchCode: string;
  quantity: Prisma.Decimal;
  costPerUnit: Prisma.Decimal;
}

interface LockedBatchRow {
  id: string;
  batch_code: string;
  current_quantity: Prisma.Decimal;
  cost_price_per_unit: Prisma.Decimal;
}

/**
 * FIFO batch consumption (TRD §5.1).
 *
 * Runs INSIDE an existing Prisma interactive transaction. Batches are locked
 * with SELECT … FOR UPDATE ordered by purchase_date so concurrent orders can
 * never oversell; the DB CHECK (current_quantity >= 0) is the final backstop.
 */
@Injectable()
export class FifoService {
  async consume(
    tx: Prisma.TransactionClient,
    params: {
      storeId: string;
      fabricName: string;
      quantity: Prisma.Decimal | number;
      orderId?: string;
      userId?: string;
      referenceDocument?: string;
    },
  ): Promise<FifoConsumption[]> {
    const required = new Prisma.Decimal(params.quantity);

    const batches = await tx.$queryRaw<LockedBatchRow[]>`
      SELECT id, batch_code, current_quantity, cost_price_per_unit
      FROM inventory_batches
      WHERE store_id = ${params.storeId}::uuid
        AND fabric_name = ${params.fabricName}
        AND status = 'available'
        AND current_quantity > 0
      ORDER BY purchase_date ASC, created_at ASC
      FOR UPDATE
    `;

    const totalAvailable = batches.reduce(
      (sum, b) => sum.add(b.current_quantity),
      new Prisma.Decimal(0),
    );
    if (totalAvailable.lessThan(required)) {
      throw new UnprocessableEntityException({
        message: `Insufficient stock for ${params.fabricName}`,
        required: required.toString(),
        available: totalAvailable.toString(),
      });
    }

    const consumed: FifoConsumption[] = [];
    let remaining = required;

    for (const batch of batches) {
      if (remaining.lessThanOrEqualTo(0)) break;

      const take = Prisma.Decimal.min(remaining, batch.current_quantity);
      const newBalance = new Prisma.Decimal(batch.current_quantity).sub(take);

      await tx.inventoryBatch.update({
        where: { id: batch.id },
        data: {
          currentQuantity: newBalance,
          ...(newBalance.isZero() ? { status: 'depleted' } : {}),
        },
      });
      await tx.inventoryMovement.create({
        data: {
          batchId: batch.id,
          orderId: params.orderId,
          movementType: 'order_out',
          quantity: take,
          previousBalance: batch.current_quantity,
          newBalance,
          referenceDocument: params.referenceDocument,
          createdById: params.userId,
        },
      });

      consumed.push({
        batchId: batch.id,
        batchCode: batch.batch_code,
        quantity: take,
        costPerUnit: new Prisma.Decimal(batch.cost_price_per_unit),
      });
      remaining = remaining.sub(take);
    }

    return consumed;
  }
}
