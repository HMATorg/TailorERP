/**
 * The M1–M8 body measurement matrix (v4 amendment §2).
 *
 * Shared so the API, the customer PWA, the counter and the workshop tablet all
 * name the same eight points the same way. The API serves the labels too
 * (`GET /customer/measurements/points`) so a client never has to hardcode them.
 */
export const MEASUREMENT_POINT_KEYS = [
  'm1TotalLength',
  'm2ShoulderWidth',
  'm3SleeveLength',
  'm4ChestCirc',
  'm5HipWidth',
  'm6NeckDiameter',
  'm7WristOpening',
  'm8SkirtPerimeter',
] as const;

export type MeasurementPointKey = (typeof MEASUREMENT_POINT_KEYS)[number];

export interface MeasurementPoint {
  key: MeasurementPointKey;
  label: string;
  labelAr: string;
}

/** One immutable snapshot. Superseded versions are kept, never overwritten. */
export interface MeasurementSnapshot extends Partial<Record<MeasurementPointKey, string | null>> {
  id: string;
  garmentType: string;
  version: number;
  isActive: boolean;
  extra?: Record<string, unknown> | null;
  notes?: string | null;
  createdAt: string;
  store?: { id: string; name: string } | null;
  takenBy?: { id: string; fullName: string } | null;
}

export interface GarmentMeasurementHistory {
  garmentType: string;
  /** null when every snapshot for this garment has been superseded. */
  activeVersion: number | null;
  latestTakenAt: string | null;
  /** Newest first. Find the active one by its flag, not by position. */
  versions: MeasurementSnapshot[];
}

/** What the workshop tablet shows for a production ticket. */
export interface TicketMeasurements {
  ticketId: string;
  ticketCode: string;
  station: string;
  orderNumber: string;
  garmentType: string;
  sequenceNo: number;
  design: {
    collarStyle: string | null;
    cuffStyle: string | null;
    pocketStyle: string | null;
    stitchingStyle: string | null;
  };
  yieldMeters: string | null;
  points: readonly MeasurementPoint[];
  /** The snapshot this garment is being cut to — not necessarily the active one. */
  cutAgainst: MeasurementSnapshot | null;
  /** A newer snapshot exists; the floor keeps working to `cutAgainst`. */
  supersededByNewerVersion: boolean;
  history: MeasurementSnapshot[];
}
