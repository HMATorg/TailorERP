import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FifoService } from './fifo.service';

interface BatchRow {
  id: string;
  batch_code: string;
  current_quantity: Prisma.Decimal;
  cost_price_per_unit: Prisma.Decimal;
}

function makeTx(batches: BatchRow[]) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(batches),
    inventoryBatch: { update: jest.fn().mockResolvedValue({}) },
    inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
  };
}

const batch = (id: string, code: string, qty: number, cost = 20): BatchRow => ({
  id,
  batch_code: code,
  current_quantity: new Prisma.Decimal(qty),
  cost_price_per_unit: new Prisma.Decimal(cost),
});

describe('FifoService.consume (TRD §5.1)', () => {
  const service = new FifoService();
  const params = { storeId: 'store-1', fabricName: 'Cotton', userId: 'user-1' };

  it('draws entirely from the oldest batch when it covers the requirement', async () => {
    const tx = makeTx([batch('b1', 'B-001', 100), batch('b2', 'B-002', 50)]);

    const result = await service.consume(tx as never, { ...params, quantity: 40 });

    expect(result).toHaveLength(1);
    expect(result[0].batchCode).toBe('B-001');
    expect(result[0].quantity.toString()).toBe('40');
    expect(tx.inventoryBatch.update).toHaveBeenCalledTimes(1);
  });

  it('spans multiple batches oldest-first when one is insufficient', async () => {
    const tx = makeTx([batch('b1', 'B-001', 84.5), batch('b2', 'B-002', 200)]);

    const result = await service.consume(tx as never, { ...params, quantity: 100 });

    expect(result.map((r) => [r.batchCode, r.quantity.toString()])).toEqual([
      ['B-001', '84.5'],
      ['B-002', '15.5'],
    ]);
  });

  it('marks a batch depleted when it is fully consumed', async () => {
    const tx = makeTx([batch('b1', 'B-001', 50), batch('b2', 'B-002', 50)]);

    await service.consume(tx as never, { ...params, quantity: 50 });

    expect(tx.inventoryBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ status: 'depleted' }),
      }),
    );
  });

  it('does not mark a partially consumed batch depleted', async () => {
    const tx = makeTx([batch('b1', 'B-001', 50)]);

    await service.consume(tx as never, { ...params, quantity: 20 });

    const data = tx.inventoryBatch.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.currentQuantity.toString()).toBe('30');
  });

  it('rejects with 422 and reports availability when stock is short', async () => {
    const tx = makeTx([batch('b1', 'B-001', 10), batch('b2', 'B-002', 5)]);

    await expect(
      service.consume(tx as never, { ...params, quantity: 100 }),
    ).rejects.toMatchObject({
      response: { required: '100', available: '15' },
    });
    await expect(
      service.consume(tx as never, { ...params, quantity: 100 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(tx.inventoryBatch.update).not.toHaveBeenCalled();
  });

  it('writes an order_out movement with correct running balances', async () => {
    const tx = makeTx([batch('b1', 'B-001', 80)]);

    await service.consume(tx as never, {
      ...params,
      quantity: 30,
      orderId: 'order-9',
      referenceDocument: 'ORD-000009',
    });

    expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchId: 'b1',
        orderId: 'order-9',
        movementType: 'order_out',
        referenceDocument: 'ORD-000009',
        createdById: 'user-1',
      }),
    });
    const movement = tx.inventoryMovement.create.mock.calls[0][0].data;
    expect(movement.quantity.toString()).toBe('30');
    expect(movement.previousBalance.toString()).toBe('80');
    expect(movement.newBalance.toString()).toBe('50');
  });

  it('locks rows with SELECT … FOR UPDATE ordered by purchase date', async () => {
    const tx = makeTx([batch('b1', 'B-001', 10)]);

    await service.consume(tx as never, { ...params, quantity: 5 });

    const sql = tx.$queryRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('ORDER BY purchase_date ASC');
  });

  it('handles fractional quantities without floating-point drift', async () => {
    const tx = makeTx([batch('b1', 'B-001', 0.3)]);

    const result = await service.consume(tx as never, { ...params, quantity: 0.1 });

    expect(result[0].quantity.toString()).toBe('0.1');
    expect(tx.inventoryBatch.update.mock.calls[0][0].data.currentQuantity.toString()).toBe('0.2');
  });
});
