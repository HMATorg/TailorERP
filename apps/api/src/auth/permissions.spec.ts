import {
  canTransition,
  computeEffectivePermissions,
  PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
} from '@tailonix/shared';

describe('computeEffectivePermissions (TRD §4.1)', () => {
  it('hq_admin holds every permission by default', () => {
    // Counted against PERMISSIONS rather than a literal: this assertion is here
    // to catch a role losing coverage, not to freeze the size of the enum.
    const effective = computeEffectivePermissions('hq_admin');
    expect(effective.size).toBe(PERMISSIONS.length);
    for (const p of PERMISSIONS) expect(effective.has(p)).toBe(true);
  });

  it('separates counter, workshop and back-office capability (D-043)', () => {
    const cashier = computeEffectivePermissions('cashier');
    const tailor = computeEffectivePermissions('tailor');

    // The till does not carry order administration or the workshop floor.
    expect(cashier.has('pos_checkout')).toBe(true);
    expect(cashier.has('pos_settle')).toBe(true);
    expect(cashier.has('manage_orders')).toBe(false);
    expect(cashier.has('view_workshop')).toBe(false);
    expect(cashier.has('manage_workshop')).toBe(false);

    // The workshop floor moves tickets and reads measurements, but has no till.
    expect(tailor.has('view_workshop')).toBe(true);
    expect(tailor.has('manage_workshop')).toBe(true);
    expect(tailor.has('view_measurement_history')).toBe(true);
    expect(tailor.has('use_pos')).toBe(false);
    expect(tailor.has('pos_checkout')).toBe(false);

    // Measurements stay read-only for staff who work the floor but don't run
    // the counter — a tailor cuts to the record, they don't edit it.
    expect(tailor.has('manage_measurements')).toBe(false);
  });

  it('lets the counter register a walk-in and take their measurements (D-046)', () => {
    // Before this, only manage_customers holders (store_manager+) could create
    // a customer — a cashier had to route every walk-in through someone else,
    // which is exactly the "wait for admin" friction the counter exists to avoid.
    const cashier = computeEffectivePermissions('cashier');
    expect(cashier.has('manage_customers')).toBe(true);
    expect(cashier.has('manage_measurements')).toBe(true);
    // Still no back-office order administration or workshop access.
    expect(cashier.has('manage_orders')).toBe(false);
    expect(cashier.has('manage_workshop')).toBe(false);
  });

  it('lets the counter see fabric stock so checkout can actually run (D-048)', () => {
    // GET /inventory/sellable fills the fabric-roll picker Counter's own
    // checkout depends on — found by running the whole flow as a real
    // cashier account for the first time, not by auditing the table by eye.
    const cashier = computeEffectivePermissions('cashier');
    expect(cashier.has('view_inventory')).toBe(true);
    // Read-only: managing stock, batches, or transfers is still out of reach.
    expect(cashier.has('manage_inventory')).toBe(false);
    expect(cashier.has('select_batches')).toBe(false);
    expect(cashier.has('transfer_inventory')).toBe(false);
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
