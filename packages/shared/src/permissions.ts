import type { StaffRole } from './roles';

/**
 * Granular permissions (PRD §4.6). Role defaults below can be overridden per
 * user per store via the JSONB `permissions` column on user_store_roles
 * (format: { grant: Permission[], revoke: Permission[] }).
 *
 * The POS and workshop entries are deliberately their own permissions rather
 * than reuses of `create_orders` / `update_order_status` (D-043). Those are
 * back-office capabilities, and the counter and the workshop floor are
 * different rooms with different staff: a shop needs to hand someone the till
 * without also handing them order administration, and needs the workshop
 * tablet to move tickets without exposing the counter.
 */
export const PERMISSIONS = [
  'view_dashboard',
  'view_orders',
  'create_orders',
  'manage_orders',
  'update_order_status',
  'process_payments',
  'view_customers',
  'manage_customers',
  'view_measurements',
  'view_measurement_history',
  'manage_measurements',
  'view_inventory',
  'manage_inventory',
  'select_batches',
  'transfer_inventory',
  'manage_appointments',
  'manage_roles',
  'manage_stores',
  /// Org-wide compliance settings (currently: ZATCA onboarding) — hq_admin only, see D-058
  'manage_organization',
  // Counter (POS)
  'use_pos',
  'pos_checkout',
  'pos_settle',
  // Workshop floor
  'view_workshop',
  'manage_workshop',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_DEFAULT_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  hq_admin: PERMISSIONS,
  // Oversight across stores: sees everything, changes nothing on the floor.
  regional_manager: [
    'view_dashboard',
    'view_orders',
    'view_inventory',
    'view_customers',
    'manage_customers',
    'view_measurements',
    'view_measurement_history',
    'view_workshop',
  ],
  store_manager: [
    'view_dashboard',
    'view_orders',
    'create_orders',
    'manage_orders',
    'update_order_status',
    'process_payments',
    'view_customers',
    'manage_customers',
    'view_measurements',
    'view_measurement_history',
    'manage_measurements',
    'view_inventory',
    'manage_inventory',
    'select_batches',
    'manage_appointments',
    'use_pos',
    'pos_checkout',
    'pos_settle',
    'view_workshop',
    'manage_workshop',
  ],
  // Works the floor: reads the full measurement history to cut against, and
  // moves tickets between stations. No till.
  tailor: [
    'view_orders',
    'update_order_status',
    'select_batches',
    'view_measurements',
    'view_measurement_history',
    'view_inventory',
    'view_workshop',
    'manage_workshop',
  ],
  // Works the counter: takes orders and money, and — per D-046 — registers a
  // walk-in customer and takes their first measurements without needing a
  // manager or the admin app in the loop. `view_inventory` is here because
  // checkout structurally requires it — GET /inventory/sellable is what fills
  // the fabric-roll picker — not because a cashier manages stock (D-048).
  // No workshop.
  cashier: [
    'view_orders',
    'create_orders',
    'process_payments',
    'view_customers',
    'manage_customers',
    'view_measurements',
    'manage_measurements',
    'view_inventory',
    'use_pos',
    'pos_checkout',
    'pos_settle',
  ],
};

export interface PermissionOverrides {
  grant?: Permission[];
  revoke?: Permission[];
}

/** Effective permissions = role defaults + grants − revokes (TRD §4.1). */
export function computeEffectivePermissions(
  role: StaffRole,
  overrides?: PermissionOverrides | null,
): Set<Permission> {
  const effective = new Set<Permission>(ROLE_DEFAULT_PERMISSIONS[role] ?? []);
  overrides?.grant?.forEach((p) => effective.add(p));
  overrides?.revoke?.forEach((p) => effective.delete(p));
  return effective;
}
