export const APPOINTMENT_TYPES = [
  'measurement',
  'first_fitting',
  'final_fitting',
  'pickup',
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const MOVEMENT_TYPES = [
  'purchase_in',
  'order_out',
  'transfer_out',
  'transfer_in',
  'adjustment',
  'return_in',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const ALERT_STATUSES = ['pending', 'acknowledged', 'ordered', 'resolved'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SUPPORTED_LANGUAGES = ['en', 'ar', 'ur'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const RTL_LANGUAGES: readonly Language[] = ['ar', 'ur'];

/** Custom header carrying the active store context (TRD §4.1). */
export const STORE_ID_HEADER = 'x-store-id';
