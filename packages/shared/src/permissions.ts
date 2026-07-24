import type { StaffRole } from './roles';

/**
 * The 17 granular permissions (PRD §4.6). Role defaults below can be overridden
 * per user per store via the JSONB `permissions` column on user_store_roles
 * (format: { grant: Permission[], revoke: Permission[] }).
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
  'manage_measurements',
  'view_inventory',
  'manage_inventory',
  'select_batches',
  'transfer_inventory',
  'manage_appointments',
  'manage_roles',
  'manage_stores',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_DEFAULT_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  hq_admin: PERMISSIONS,
  regional_manager: [
    'view_dashboard',
    'view_orders',
    'view_inventory',
    'view_customers',
    'manage_customers',
    'view_measurements',
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
    'manage_measurements',
    'view_inventory',
    'manage_inventory',
    'select_batches',
    'manage_appointments',
  ],
  tailor: [
    'view_orders',
    'update_order_status',
    'select_batches',
    'view_measurements',
    'view_inventory',
  ],
  cashier: ['view_orders', 'create_orders', 'process_payments', 'view_customers'],
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
