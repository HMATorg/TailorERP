import {
  canTransition,
  computeEffectivePermissions,
  PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from '@tailonix/shared';

describe('computeEffectivePermissions (TRD §4.1)', () => {
  it('hq_admin holds all 17 permissions by default', () => {
    expect(PERMISSIONS).toHaveLength(17);
    const effective = computeEffectivePermissions('hq_admin');
    expect(effective.size).toBe(17);
  });

  it('cashier defaults match PRD §4.6', () => {
    const effective = computeEffectivePermissions('cashier');
    expect(effective.has('create_orders')).toBe(true);
    expect(effective.has('process_payments')).toBe(true);
    expect(effective.has('manage_inventory')).toBe(false);
    expect(effective.has('update_order_status')).toBe(false);
  });

  it('grant overrides add permissions beyond role defaults', () => {
    const effective = computeEffectivePermissions('cashier', {
      grant: ['view_inventory'],
    });
    expect(effective.has('view_inventory')).toBe(true);
  });

  it('revoke overrides remove default permissions', () => {
    const effective = computeEffectivePermissions('store_manager', {
      revoke: ['process_payments'],
    });
    expect(effective.has('process_payments')).toBe(false);
    expect(effective.has('manage_orders')).toBe(true);
  });

  it('revoke wins when the same permission is granted and revoked', () => {
    const effective = computeEffectivePermissions('tailor', {
      grant: ['view_dashboard'],
      revoke: ['view_dashboard'],
    });
    expect(effective.has('view_dashboard')).toBe(false);
  });

  it('every role default is a valid permission', () => {
    for (const perms of Object.values(ROLE_DEFAULT_PERMISSIONS)) {
      for (const p of perms) {
        expect(PERMISSIONS).toContain(p);
      }
    }
  });
});

describe('order status transitions (D-010)', () => {
  it('follows the happy path pending → … → delivered', () => {
    expect(canTransition('pending', 'cutting')).toBe(true);
    expect(canTransition('cutting', 'sewing')).toBe(true);
    expect(canTransition('sewing', 'fitting')).toBe(true);
    expect(canTransition('fitting', 'ready')).toBe(true);
    expect(canTransition('ready', 'delivered')).toBe(true);
  });

  it('allows fitting to send work back to sewing', () => {
    expect(canTransition('fitting', 'sewing')).toBe(true);
  });

  it('blocks skipping steps and reversing terminal states', () => {
    expect(canTransition('pending', 'ready')).toBe(false);
    expect(canTransition('delivered', 'pending')).toBe(false);
    expect(canTransition('cancelled', 'pending')).toBe(false);
  });

  it('allows cancellation from any active state but not terminal ones', () => {
    for (const from of ['pending', 'cutting', 'sewing', 'fitting', 'ready'] as const) {
      expect(canTransition(from, 'cancelled')).toBe(true);
    }
    expect(canTransition('delivered', 'cancelled')).toBe(false);
  });
});
