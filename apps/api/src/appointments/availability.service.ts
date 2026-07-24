import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const SLOT_MINUTES = 30;

interface OperatingWindow {
  open: string; // "09:00"
  close: string; // "21:00"
}

/**
 * Appointment slot availability (TRD §5.3): slots come from the store's
 * operating hours; a slot is bookable when no active appointment overlaps it.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getSlots(storeId: string, dateISO: string, durationMinutes = SLOT_MINUTES) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { operatingHours: true, status: true },
    });
    if (!store) throw new NotFoundException('Store not found');
    if (store.status !== 'active') {
      return { date: dateISO, slots: [] };
    }

    const date = new Date(`${dateISO}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    const hours = store.operatingHours as Record<string, OperatingWindow> | null;
    const window = hours?.[DAY_KEYS[date.getDay()]];
    if (!window?.open || !window?.close) {
      return { date: dateISO, slots: [] };
    }

    const dayStart = this.atTime(date, window.open);
    const dayEnd = this.atTime(date, window.close);

    const existing = await this.prisma.appointment.findMany({
      where: {
        storeId,
        status: { in: ['scheduled', 'confirmed', 'in_progress'] },
        scheduledAt: { gte: dayStart, lt: dayEnd },
      },
      select: { scheduledAt: true, durationMinutes: true },
    });

    const now = new Date();
    const slots: { time: string; available: boolean }[] = [];
    for (
      let slot = dayStart;
      slot.getTime() + durationMinutes * 60_000 <= dayEnd.getTime();
      slot = new Date(slot.getTime() + SLOT_MINUTES * 60_000)
    ) {
      const slotEnd = new Date(slot.getTime() + durationMinutes * 60_000);
      const overlaps = existing.some((a) => {
        const aStart = a.scheduledAt;
        const aEnd = new Date(aStart.getTime() + a.durationMinutes * 60_000);
        return slot < aEnd && aStart < slotEnd;
      });
      slots.push({
        time: slot.toISOString(),
        available: !overlaps && slot > now,
      });
    }
    return { date: dateISO, slots };
  }

  async assertSlotFree(storeId: string, scheduledAt: Date, durationMinutes: number, excludeId?: string) {
    const end = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
    const clash = await this.prisma.appointment.findFirst({
      where: {
        storeId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        status: { in: ['scheduled', 'confirmed', 'in_progress'] },
        scheduledAt: { lt: end },
      },
      select: { id: true, scheduledAt: true, durationMinutes: true },
      orderBy: { scheduledAt: 'desc' },
    });
    if (clash) {
      const clashEnd = new Date(clash.scheduledAt.getTime() + clash.durationMinutes * 60_000);
      if (scheduledAt < clashEnd) {
        throw new BadRequestException('This time slot is no longer available');
      }
    }
  }

  private atTime(date: Date, hhmm: string): Date {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h, m, 0, 0);
    return d;
  }
}
