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
  // M9-M13 (D-055), added against a real tailor shop's own paper order form.
  'm9Waist',
  'm10RoundShoulder',
  'm11MidHand',
  'm12PlateLength',
  'm13HalfChest',
] as const;

export type MeasurementPointKey = (typeof MEASUREMENT_POINT_KEYS)[number];

/**
 * Trousers is not a robe — it has no sleeve, no neck, no hem in the M1-M8
 * sense, and the M1-M8 column names are literally named for a thobe's
 * construction (D-054). Its own seven points, same "shared so every surface
 * agrees" reasoning as the M-matrix above.
 */
export const TROUSER_POINT_KEYS = [
  't1Waist',
  't2Hip',
  't3Inseam',
  't4Outseam',
  't5Thigh',
  't6Knee',
  't7AnkleOpening',
] as const;

export type TrouserPointKey = (typeof TROUSER_POINT_KEYS)[number];

/** Every point key across every garment family — the full column set a snapshot may carry. */
export type AnyPointKey = MeasurementPointKey | TrouserPointKey;

export interface MeasurementPoint {
  key: AnyPointKey;
  label: string;
  labelAr: string;
}

/**
 * Thobe, Bisht and Shirt are all "long garment with body + sleeve + neck +
 * hem" shapes — the M1-M8 matrix genuinely applies to all three, just with
 * different typical values. Trousers is the only family with a disjoint
 * measurement vocabulary. Defaults unknown types to 'robe' rather than
 * throwing, since garmentType is a free string (D-051) and a new type should
 * degrade to the more common family, not break.
 */
export function garmentFamily(garmentType: string): 'robe' | 'trousers' {
  return garmentType === 'Trousers' ? 'trousers' : 'robe';
}

/** One immutable snapshot. Superseded versions are kept, never overwritten. */
export interface MeasurementSnapshot extends Partial<Record<AnyPointKey, string | null>> {
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
