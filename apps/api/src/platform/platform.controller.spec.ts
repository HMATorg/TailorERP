import 'reflect-metadata';
import { PlatformController } from './platform.controller';
import type { AccessTokenPayload } from '../auth/auth.types';

/**
 * PlatformController (D-060) — thin delegation only; the actual business
 * logic is covered by `platform.service.spec.ts` and the authorization gate
 * by `platform-admin.guard.spec.ts`. This just locks in that every route
 * passes the right args (actor id, params, dto, ip) to the right service call.
 */
function build() {
  const platform = {
    getMetrics: jest.fn(),
    listOrganizations: jest.fn(),
    getOrganization: jest.fn(),
    createOrganization: jest.fn(),
    updateOrganization: jest.fn(),
    changeSubscription: jest.fn(),
    listPlans: jest.fn(),
    upsertPlan: jest.fn(),
    impersonate: jest.fn(),
    listPlatformAdmins: jest.fn(),
    createPlatformAdmin: jest.fn(),
    updatePlatformAdmin: jest.fn(),
    listAuditLogs: jest.fn(),
  };
  const controller = new PlatformController(platform as never);
  const principal = { sub: 'actor-1', typ: 'platform' } as AccessTokenPayload;
  return { controller, platform, principal };
}

describe('PlatformController', () => {
  it('getMetrics delegates with no args', () => {
    const { controller, platform } = build();
    controller.getMetrics();
    expect(platform.getMetrics).toHaveBeenCalledWith();
  });

  it('listOrganizations forwards status and search query params', () => {
    const { controller, platform } = build();
    controller.listOrganizations('active', 'acme');
    expect(platform.listOrganizations).toHaveBeenCalledWith({ status: 'active', search: 'acme' });
  });

  it('getOrganization forwards the id param', () => {
    const { controller, platform } = build();
    controller.getOrganization('org-1');
    expect(platform.getOrganization).toHaveBeenCalledWith('org-1');
  });

  it('createOrganization forwards actor id, dto, and ip', () => {
    const { controller, platform, principal } = build();
    const dto = { name: 'Acme' } as never;
    controller.createOrganization(principal, dto, '127.0.0.1');
    expect(platform.createOrganization).toHaveBeenCalledWith('actor-1', dto, '127.0.0.1');
  });

  it('updateOrganization forwards actor id, org id, dto, and ip', () => {
    const { controller, platform, principal } = build();
    const dto = { name: 'New name' } as never;
    controller.updateOrganization(principal, 'org-1', dto, '127.0.0.1');
    expect(platform.updateOrganization).toHaveBeenCalledWith('actor-1', 'org-1', dto, '127.0.0.1');
  });

  it('getSubscription resolves the org then returns its subscription field', async () => {
    const { controller, platform } = build();
    platform.getOrganization.mockResolvedValue({ id: 'org-1', subscription: { status: 'active' } });
    const result = await controller.getSubscription('org-1');
    expect(platform.getOrganization).toHaveBeenCalledWith('org-1');
    expect(result).toEqual({ status: 'active' });
  });

  it('changeSubscription forwards actor id, org id, dto, and ip', () => {
    const { controller, platform, principal } = build();
    const dto = { planCode: 'pro' } as never;
    controller.changeSubscription(principal, 'org-1', dto, '127.0.0.1');
    expect(platform.changeSubscription).toHaveBeenCalledWith('actor-1', 'org-1', dto, '127.0.0.1');
  });

  it('listPlans delegates with no args', () => {
    const { controller, platform } = build();
    controller.listPlans();
    expect(platform.listPlans).toHaveBeenCalledWith();
  });

  it('upsertPlan forwards actor id, dto, and ip', () => {
    const { controller, platform, principal } = build();
    const dto = { code: 'pro' } as never;
    controller.upsertPlan(principal, dto, '127.0.0.1');
    expect(platform.upsertPlan).toHaveBeenCalledWith('actor-1', dto, '127.0.0.1');
  });

  it('impersonate forwards actor id, org id, and ip', () => {
    const { controller, platform, principal } = build();
    controller.impersonate(principal, 'org-1', '127.0.0.1');
    expect(platform.impersonate).toHaveBeenCalledWith('actor-1', 'org-1', '127.0.0.1');
  });

  it('listPlatformAdmins delegates with no args', () => {
    const { controller, platform } = build();
    controller.listPlatformAdmins();
    expect(platform.listPlatformAdmins).toHaveBeenCalledWith();
  });

  it('createPlatformAdmin forwards actor id, dto, and ip', () => {
    const { controller, platform, principal } = build();
    const dto = { email: 'a@b.com' } as never;
    controller.createPlatformAdmin(principal, dto, '127.0.0.1');
    expect(platform.createPlatformAdmin).toHaveBeenCalledWith('actor-1', dto, '127.0.0.1');
  });

  it('updatePlatformAdmin forwards actor id, target id, dto, and ip', () => {
    const { controller, platform, principal } = build();
    const dto = { isActive: false } as never;
    controller.updatePlatformAdmin(principal, 'admin-2', dto, '127.0.0.1');
    expect(platform.updatePlatformAdmin).toHaveBeenCalledWith('actor-1', 'admin-2', dto, '127.0.0.1');
  });

  it('auditLogs forwards filters and coerces the page query string to a number', () => {
    const { controller, platform } = build();
    controller.auditLogs('org-1', 'created', '3');
    expect(platform.listAuditLogs).toHaveBeenCalledWith({
      organizationId: 'org-1',
      action: 'created',
      page: 3,
    });
  });

  it('auditLogs leaves page undefined when not provided', () => {
    const { controller, platform } = build();
    controller.auditLogs(undefined, undefined, undefined);
    expect(platform.listAuditLogs).toHaveBeenCalledWith({
      organizationId: undefined,
      action: undefined,
      page: undefined,
    });
  });
});
