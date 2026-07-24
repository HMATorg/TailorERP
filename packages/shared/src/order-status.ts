/**
 * Order lifecycle (PRD C-3): pending → cutting → sewing → fitting → ready → delivered.
 * `cancelled` is reachable from any non-terminal state. See D-010.
 */
export const ORDER_STATUSES = [
  'pending',
  'cutting',
  'sewing',
  'fitting',
  'ready',
  'delivered',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The five steps shown on the PWA tracking stepper (wireframes §3.6b). */
export const TRACKING_STEPS: readonly OrderStatus[] = [
  'pending',
  'cutting',
  'sewing',
  'fitting',
  'ready',
];

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['cutting', 'cancelled'],
  cutting: ['sewing', 'cancelled'],
  sewing: ['fitting', 'cancelled'],
  fitting: ['ready', 'sewing', 'cancelled'], // fitting can send an item back to sewing
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}
