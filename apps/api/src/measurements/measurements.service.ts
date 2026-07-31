import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { garmentFamily, type MeasurementPoint } from '@tailonix/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * One read model for the M1–M8 matrix, shared by everyone who displays it:
 * the customer's own PWA view, the counter, the tailor, and the workshop floor.
 *
 * It is deliberately a single select. The same numbers are cut against, quoted
 * from, and shown to the customer, so three hand-maintained field lists would be
 * three chances for one surface to quietly show a different figure than the
 * person holding the scissors (D-044).
 *
 * Read-only by design. Snapshots are created through
 * `CustomersService.addMeasurement`, which versions and supersedes; nothing here
 * writes, so no display path can edit what a garment was cut against.
 */
export const MEASUREMENT_SELECT = {
  id: true,
  garmentType: true,
  version: true,
  isActive: true,
  m1TotalLength: true,
  m2ShoulderWidth: true,
  m3SleeveLength: true,
  m4ChestCirc: true,
  m5HipWidth: true,
  m6NeckDiameter: true,
  m7WristOpening: true,
  m8SkirtPerimeter: true,
  m9Waist: true,
  m10RoundShoulder: true,
  m11MidHand: true,
  m12PlateLength: true,
  m13HalfChest: true,
  t1Waist: true,
  t2Hip: true,
  t3Inseam: true,
  t4Outseam: true,
  t5Thigh: true,
  t6Knee: true,
  t7AnkleOpening: true,
  extra: true,
  notes: true,
  createdAt: true,
  store: { select: { id: true, name: true } },
  takenBy: { select: { id: true, fullName: true } },
} satisfies Prisma.MeasurementSelect;

export type MeasurementSnapshot = Prisma.MeasurementGetPayload<{
  select: typeof MEASUREMENT_SELECT;
}>;

/**
 * The robe-family points (Thobe/Bisht/Shirt), in diagram order. M9-M13 added
 * D-055 against a real tailor shop's own paper order form; m5HipWidth is
 * relabeled "Hip" now that m9Waist exists as the dedicated waist point —
 * historical rows captured under the old combined "Waist/Hip" meaning are
 * unaffected, since the DB column itself is unchanged.
 */
export const MEASUREMENT_POINTS: readonly MeasurementPoint[] = [
  { key: 'm1TotalLength', label: 'Total length', labelAr: 'الطول' },
  { key: 'm2ShoulderWidth', label: 'Shoulder', labelAr: 'الكتف' },
  { key: 'm3SleeveLength', label: 'Sleeve', labelAr: 'الكم' },
  { key: 'm4ChestCirc', label: 'Chest', labelAr: 'الصدر' },
  { key: 'm5HipWidth', label: 'Hip', labelAr: 'الورك' },
  { key: 'm6NeckDiameter', label: 'Neck', labelAr: 'الرقبة' },
  { key: 'm7WristOpening', label: 'Wrist', labelAr: 'الوسع' },
  { key: 'm8SkirtPerimeter', label: 'Hem (Ghera)', labelAr: 'الذيل' },
  { key: 'm9Waist', label: 'Waist', labelAr: 'الوسط' },
  { key: 'm10RoundShoulder', label: 'Round Shoulder', labelAr: 'الكتف المدور' },
  { key: 'm11MidHand', label: 'Mid of Hand', labelAr: 'منتصف اليد' },
  { key: 'm12PlateLength', label: 'Plate Length', labelAr: 'طول اللوح' },
  { key: 'm13HalfChest', label: 'Half Chest', labelAr: 'نصف الصدر' },
];

/** Trousers' own seven points (D-054) — no sleeve, neck or hem in the M1-M8 sense. */
export const TROUSER_MEASUREMENT_POINTS: readonly MeasurementPoint[] = [
  { key: 't1Waist', label: 'Waist', labelAr: 'الخصر' },
  { key: 't2Hip', label: 'Hip', labelAr: 'الورك' },
  { key: 't3Inseam', label: 'Inseam', labelAr: 'الداخلي' },
  { key: 't4Outseam', label: 'Outseam / total length', labelAr: 'الطول الكلي' },
  { key: 't5Thigh', label: 'Thigh', labelAr: 'الفخذ' },
  { key: 't6Knee', label: 'Knee', labelAr: 'الركبة' },
  { key: 't7AnkleOpening', label: 'Ankle opening', labelAr: 'فتحة الأسفل' },
];

/** The full point set across both families — what a client renders sparsely per snapshot. */
export const ALL_MEASUREMENT_POINTS: readonly MeasurementPoint[] = [
  ...MEASUREMENT_POINTS,
  ...TROUSER_MEASUREMENT_POINTS,
];

export function pointsForGarmentType(garmentType: string): readonly MeasurementPoint[] {
  return garmentFamily(garmentType) === 'trousers' ? TROUSER_MEASUREMENT_POINTS : MEASUREMENT_POINTS;
}

export interface GarmentMeasurementHistory {
  garmentType: string;
  activeVersion: number | null;
  latestTakenAt: Date | null;
  /** Newest first; the active snapshot is flagged, never assumed to be [0]. */
  versions: MeasurementSnapshot[];
}

@Injectable()
export class MeasurementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Verifies the customer belongs to the org before any read crosses tenants. */
  private async assertCustomerInOrg(organizationId: string, customerId: string): Promise<void> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
  }

  /** Only the snapshots currently being cut against — one per garment type. */
  async active(customerId: string): Promise<MeasurementSnapshot[]> {
    return this.prisma.measurement.findMany({
      where: { customerId, isActive: true },
      orderBy: { garmentType: 'asc' },
      select: MEASUREMENT_SELECT,
    });
  }

  /**
   * Every version ever taken, grouped by garment. Superseded snapshots are kept
   * and shown rather than hidden: a customer asking "why does this one fit
   * differently" is answered by the history, and a tailor re-cutting an old
   * order needs the numbers that order was actually cut against.
   */
  async history(customerId: string): Promise<GarmentMeasurementHistory[]> {
    const rows = await this.prisma.measurement.findMany({
      where: { customerId },
      orderBy: [{ garmentType: 'asc' }, { version: 'desc' }],
      select: MEASUREMENT_SELECT,
    });

    const byGarment = new Map<string, MeasurementSnapshot[]>();
    for (const row of rows) {
      const list = byGarment.get(row.garmentType);
      if (list) list.push(row);
      else byGarment.set(row.garmentType, [row]);
    }

    return [...byGarment.entries()].map(([garmentType, versions]) => ({
      garmentType,
      activeVersion: versions.find((v) => v.isActive)?.version ?? null,
      latestTakenAt: versions[0]?.createdAt ?? null,
      versions,
    }));
  }

  /** Staff-facing history, tenancy-checked. */
  async historyForStaff(
    organizationId: string,
    customerId: string,
  ): Promise<GarmentMeasurementHistory[]> {
    await this.assertCustomerInOrg(organizationId, customerId);
    return this.history(customerId);
  }

  /** Staff-facing active set, tenancy-checked. */
  async activeForStaff(organizationId: string, customerId: string): Promise<MeasurementSnapshot[]> {
    await this.assertCustomerInOrg(organizationId, customerId);
    return this.active(customerId);
  }

  /**
   * The measurements behind a production ticket, for the workshop tablet.
   *
   * Returns the exact snapshot the garment was cut against — the order item's
   * `measurementId`, not whatever is active now. A customer re-measured
   * mid-production must not silently change what the tailor is working to.
   */
  async forTicket(storeId: string, ticketId: string) {
    const ticket = await this.prisma.productionTicket.findFirst({
      where: { id: ticketId, storeId },
      select: {
        id: true,
        ticketCode: true,
        station: true,
        order: { select: { orderNumber: true, customerId: true } },
        orderItem: {
          select: {
            garmentType: true,
            sequenceNo: true,
            collarStyle: true,
            cuffStyle: true,
            pocketStyle: true,
            stitchingStyle: true,
            yieldMeters: true,
            measurement: { select: MEASUREMENT_SELECT },
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found in this store');

    const cutAgainst = ticket.orderItem.measurement;
    const history = await this.history(ticket.order.customerId);
    const forGarment = history.find((h) => h.garmentType === ticket.orderItem.garmentType);

    return {
      ticketId: ticket.id,
      ticketCode: ticket.ticketCode,
      station: ticket.station,
      orderNumber: ticket.order.orderNumber,
      garmentType: ticket.orderItem.garmentType,
      sequenceNo: ticket.orderItem.sequenceNo,
      design: {
        collarStyle: ticket.orderItem.collarStyle,
        cuffStyle: ticket.orderItem.cuffStyle,
        pocketStyle: ticket.orderItem.pocketStyle,
        stitchingStyle: ticket.orderItem.stitchingStyle,
      },
      yieldMeters: ticket.orderItem.yieldMeters,
      points: pointsForGarmentType(ticket.orderItem.garmentType),
      /** What this garment is being cut to. */
      cutAgainst,
      /**
       * True when the customer has been re-measured since this ticket was cut.
       * The workshop keeps working to `cutAgainst`; this only flags that a newer
       * snapshot exists so nobody assumes the active one applies.
       */
      supersededByNewerVersion:
        cutAgainst != null &&
        forGarment?.activeVersion != null &&
        forGarment.activeVersion > cutAgainst.version,
      history: forGarment?.versions ?? [],
    };
  }

  /**
   * The customer's own view. Scoped by the customer id on their token, so a
   * customer can only ever reach their own record.
   */
  async myHistory(customerId: string): Promise<GarmentMeasurementHistory[]> {
    if (!customerId) throw new ForbiddenException('Customer token required');
    return this.history(customerId);
  }
}
