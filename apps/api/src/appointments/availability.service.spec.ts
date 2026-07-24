import { BadRequestException } from '@nestjs/common';
import { AvailabilityService } from './availability.service';

type PrismaStub = {
  store: { findUnique: jest.Mock };
  appointment: { findMany: jest.Mock; findFirst: jest.Mock };
};

const HOURS_9_TO_17 = {
  sun: { open: '09:00', close: '17:00' },
  mon: { open: '09:00', close: '17:00' },
  tue: { open: '09:00', close: '17:00' },
  wed: { open: '09:00', close: '17:00' },
  thu: { open: '09:00', close: '17:00' },
  fri: { open: '09:00', close: '17:00' },
  sat: { open: '09:00', close: '17:00' },
};

/** A date far enough ahead that "slot > now" never filters our fixtures out. */
const FUTURE_DATE = '2030-06-12'; // Wednesday

describe('AvailabilityService (TRD §5.3)', () => {
  let prisma: PrismaStub;
  let service: AvailabilityService;

  beforeEach(() => {
    prisma = {
      store: { findUnique: jest.fn() },
      appointment: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    service = new AvailabilityService(prisma as never);
  });

  it('generates 30-minute slots across the full operating window', async () => {
    prisma.store.findUnique.mockResolvedValue({
      operatingHours: HOURS_9_TO_17,
      status: 'active',
    });
    prisma.appointment.findMany.mockResolvedValue([]);

    const { slots } = await service.getSlots('store-1', FUTURE_DATE);

    // 09:00 → 17:00 with a 30-min duration yields 16 start times (last is 16:30)
    expect(slots).toHaveLength(16);
    expect(slots.every((s) => s.available)).toBe(true);
    expect(new Date(slots[0].time).getHours()).toBe(9);
    expect(new Date(slots[slots.length - 1].time).getHours()).toBe(16);
  });

  it('marks slots overlapping an existing appointment unavailable', async () => {
    prisma.store.findUnique.mockResolvedValue({
      operatingHours: HOURS_9_TO_17,
      status: 'active',
    });
    // A 60-minute booking at 10:00 must block both 10:00 and 10:30
    prisma.appointment.findMany.mockResolvedValue([
      { scheduledAt: new Date(`${FUTURE_DATE}T10:00:00`), durationMinutes: 60 },
    ]);

    const { slots } = await service.getSlots('store-1', FUTURE_DATE);
    const byTime = (h: number, m: number) =>
      slots.find((s) => {
        const d = new Date(s.time);
        return d.getHours() === h && d.getMinutes() === m;
      });

    expect(byTime(9, 30)!.available).toBe(true);
    expect(byTime(10, 0)!.available).toBe(false);
    expect(byTime(10, 30)!.available).toBe(false);
    expect(byTime(11, 0)!.available).toBe(true);
  });

  it('ignores cancelled/completed appointments when computing availability', async () => {
    prisma.store.findUnique.mockResolvedValue({
      operatingHours: HOURS_9_TO_17,
      status: 'active',
    });
    prisma.appointment.findMany.mockResolvedValue([]);

    await service.getSlots('store-1', FUTURE_DATE);

    // The query itself must scope to active statuses only
    const where = prisma.appointment.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(['scheduled', 'confirmed', 'in_progress']);
  });

  it('returns no slots on a day the store is closed', async () => {
    prisma.store.findUnique.mockResolvedValue({
      operatingHours: { mon: { open: '09:00', close: '17:00' } }, // Wednesday missing
      status: 'active',
    });

    const { slots } = await service.getSlots('store-1', FUTURE_DATE);
    expect(slots).toEqual([]);
  });

  it('returns no slots when the store itself is not active', async () => {
    prisma.store.findUnique.mockResolvedValue({
      operatingHours: HOURS_9_TO_17,
      status: 'paused',
    });

    const { slots } = await service.getSlots('store-1', FUTURE_DATE);
    expect(slots).toEqual([]);
  });

  it('rejects an invalid date', async () => {
    prisma.store.findUnique.mockResolvedValue({
      operatingHours: HOURS_9_TO_17,
      status: 'active',
    });
    await expect(service.getSlots('store-1', 'not-a-date')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('assertSlotFree', () => {
    it('throws when the requested time overlaps an existing booking', async () => {
      prisma.appointment.findFirst.mockResolvedValue({
        id: 'a1',
        scheduledAt: new Date(`${FUTURE_DATE}T10:00:00`),
        durationMinutes: 60,
      });
      await expect(
        service.assertSlotFree('store-1', new Date(`${FUTURE_DATE}T10:30:00`), 30),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('passes when the previous booking has already ended', async () => {
      prisma.appointment.findFirst.mockResolvedValue({
        id: 'a1',
        scheduledAt: new Date(`${FUTURE_DATE}T09:00:00`),
        durationMinutes: 30,
      });
      await expect(
        service.assertSlotFree('store-1', new Date(`${FUTURE_DATE}T09:30:00`), 30),
      ).resolves.toBeUndefined();
    });
  });
});
