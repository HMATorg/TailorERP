/** Org-level role — grants access to every store in the organization (see D-004). */
export const ORG_ROLES = ['hq_admin'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Store-scoped roles assigned via user_store_roles. */
export const STORE_ROLES = [
  'regional_manager',
  'store_manager',
  'tailor',
  'cashier',
] as const;
export type StoreRole = (typeof STORE_ROLES)[number];

export type StaffRole = OrgRole | StoreRole;

/** Platform-side (Tailonix internal) admin levels. */
export const PLATFORM_ADMIN_LEVELS = ['super_admin', 'billing', 'support'] as const;
export type PlatformAdminLevel = (typeof PLATFORM_ADMIN_LEVELS)[number];
