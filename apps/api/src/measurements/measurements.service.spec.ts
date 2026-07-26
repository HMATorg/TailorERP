import { NotFoundException } from '@nestjs/common';
import { MeasurementsService, MEASUREMENT_POINTS } from './measurements.service';

/** Minimal snapshot rows; only the fields these assertions touch. */
const snap = (garmentType: string, version: number, isActive: boolean, m1: string) => ({
  id: `m-${garmentType}-${version}`,
  garmentType,
  version,
  isActive,
  m1TotalLength: m1,
  createdAt: new Date(`2026-0${version}-01T10:00:00Z`),
});

function serviceWith(rows: any[], ticket?: any) {
  const prisma = {
    measurement: {
      findMany: jest.fn(async ({ where }: any) =>
        where.isActive ? rows.filter((r) => r.isActive) : rows,
      ),
    },
    customer: { findFirst: jest.fn(async (): Promise<{ id: string } | null> => ({ id: 'cust-1' })) },
    productionTicket: { findFirst: jest.fn(async () => ticket ?? null) },
  };
  return { service: new MeasurementsService(prisma as any), prisma };
}

describe('MeasurementsService', () => {
  const rows = [
    snap('Thobe', 3, true, '150.00'),
    snap('Thobe', 2, false, '148.00'),
    snap('Thobe', 1, false, '146.00'),
    snap('Bisht', 1, true, '160.00'),
  ];

  it('groups history by garment, newest version first', async () => {
    const { service } = serviceWith(rows);
    const history = await service.history('cust-1');

    expect(history.map((h) => h.garmentType).sort()).toEqual(['Bisht', 'Thobe']);
    const thobe = history.find((h) => h.garmentType === 'Thobe')!;
    expect(thobe.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(thobe.activeVersion).toBe(3);
  });

  it('keeps superseded versions rather than hiding them', async () => {
    const { service } = serviceWith(rows);
    const thobe = (await service.history('cust-1')).find((h) => h.garmentType === 'Thobe')!;
    // A customer asking why an older garment fits differently is answered by these.
    expect(thobe.versions).toHaveLength(3);
    expect(thobe.versions.filter((v) => !v.isActive)).toHaveLength(2);
  });

  it('finds the active version by flag, never by position', async () => {
    // Same rows, active one not first — ordering must not be load-bearing.
    const shuffled = [snap('Thobe', 2, false, '148.00'), snap('Thobe', 3, true, '150.00')];
    const { service } = serviceWith(shuffled);
    const thobe = (await service.history('cust-1'))[0];
    expect(thobe.activeVersion).toBe(3);
  });

  it('reports no active version when every snapshot is superseded', async () => {
    const { service } = serviceWith([snap('Thobe', 1, false, '146.00')]);
    expect((await service.history('cust-1'))[0].activeVersion).toBeNull();
  });

  it('refuses to read a customer from another organisation', async () => {
    const { service, prisma } = serviceWith(rows);
    prisma.customer.findFirst = jest.fn(async () => null);
    await expect(service.historyForStaff('other-org', 'cust-1')).rejects.toThrow(NotFoundException);
  });

  describe('forTicket', () => {
    const ticket = {
      id: 't-1',
      ticketCode: 'TKT-001',
      station: 'sewing',
      order: { orderNumber: 'ORD-000001', customerId: 'cust-1' },
      orderItem: {
        garmentType: 'Thobe',
        sequenceNo: 1,
        collarStyle: 'classic',
        cuffStyle: 'single',
        pocketStyle: 'patch',
        stitchingStyle: 'double',
        yieldMeters: '3.40',
        // Cut against v2 while v3 is now the active snapshot.
        measurement: snap('Thobe', 2, false, '148.00'),
      },
    };

    it('returns the snapshot the garment was cut against, not the active one', async () => {
      const { service } = serviceWith(rows, ticket);
      const result = await service.forTicket('store-1', 't-1');
      // Re-measuring mid-production must not change what is on the cutting table.
      expect(result.cutAgainst!.version).toBe(2);
      expect(result.cutAgainst!.m1TotalLength).toBe('148.00');
    });

    it('flags that a newer version exists without switching to it', async () => {
      const { service } = serviceWith(rows, ticket);
      const result = await service.forTicket('store-1', 't-1');
      expect(result.supersededByNewerVersion).toBe(true);
      expect(result.cutAgainst!.version).toBe(2);
    });

    it('does not flag supersession when cutting against the active version', async () => {
      const current = {
        ...ticket,
        orderItem: { ...ticket.orderItem, measurement: snap('Thobe', 3, true, '150.00') },
      };
      const { service } = serviceWith(rows, current);
      expect((await service.forTicket('store-1', 't-1')).supersededByNewerVersion).toBe(false);
    });

    it('carries the design variants and the full garment history for the floor', async () => {
      const { service } = serviceWith(rows, ticket);
      const result = await service.forTicket('store-1', 't-1');
      expect(result.design.collarStyle).toBe('classic');
      expect(result.history.map((v) => v.version)).toEqual([3, 2, 1]);
      expect(result.points).toBe(MEASUREMENT_POINTS);
    });

    it('will not read a ticket belonging to another store', async () => {
      const { service } = serviceWith(rows, undefined);
      await expect(service.forTicket('other-store', 't-1')).rejects.toThrow(NotFoundException);
    });
  });
});
