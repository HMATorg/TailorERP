import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformService } from './platform.service';

/**
 * PlatformService (D-060) — every PA-1..PA-6 mutation plus the new admin-
 * account and metrics methods, previously exercised only indirectly via
 * `platform-admin.e2e-spec.ts`. Mirrors this codebase's established
 * instantiate-with-mocks pattern (see `invoices.service.spec.ts`).
 */
function build() {
  const prisma: Record<string, unknown> = {
    organization: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
    },
    subscriptionPlan: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    organizationSubscription: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    store: { create: jest.fn(), count: jest.fn() },
    platformAdmin: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { findMany: jest.fn(), count: jest.fn() },
  };
  // Supports both call shapes this service uses: a callback (createOrganization,
  // createPlatformAdmin) and an array of queries (listAuditLogs).
  prisma.$transaction = jest.fn((arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]),
  );

  const tokens = { signAccessToken: jest.fn().mockResolvedValue('signed.jwt.token') };
  const featureGate = { invalidate: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const ledger = { ensureChartOfAccounts: jest.fn().mockResolvedValue(6) };

  const service = new PlatformService(
    prisma as never,
    tokens as never,
    featureGate as never,
    audit as never,
    ledger as never,
  );
  return { service, prisma, tokens, featureGate, audit, ledger };
}

describe('PlatformService', () => {
  describe('createOrganization (PA-2)', () => {
    const dto = {
      name: 'New Tailors',
      planCode: 'pro',
      hqAdminEmail: 'HQ@Example.Test',
      hqAdminPassword: 'Password123!',
      hqAdminFullName: 'HQ Owner',
      hqStoreName: undefined,
    };

    it('rejects an unknown plan code', async () => {
      const { service, prisma } = build();
      (prisma.subscriptionPlan as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);
      await expect(service.createOrganization('actor-1', dto as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a duplicate HQ admin email', async () => {
      const { service, prisma } = build();
      (prisma.subscriptionPlan as { findUnique: jest.Mock }).findUnique.mockResolvedValue({ id: 'plan-1' });
      (prisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.createOrganization('actor-1', dto as never)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('lowercases the HQ admin email and creates org + subscription + HQ store + HQ admin in one transaction', async () => {
      const { service, prisma, audit, ledger } = build();
      (prisma.subscriptionPlan as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'plan-1',
        code: 'pro',
      });
      (prisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);
      (prisma.organization as { create: jest.Mock }).create.mockResolvedValue({ id: 'org-1', name: dto.name });
      (prisma.organizationSubscription as { create: jest.Mock }).create.mockResolvedValue({});
      (prisma.store as { create: jest.Mock }).create.mockResolvedValue({});
      (prisma.user as { create: jest.Mock }).create.mockResolvedValue({});
      (prisma.organization as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'org-1',
        name: dto.name,
      });

      await service.createOrganization('actor-1', dto as never, '127.0.0.1');

      expect((prisma.user as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'hq@example.test', orgRole: 'hq_admin' }) }),
      );
      expect((prisma.store as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isHeadquarters: true }) }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'platform.organization_created', organizationId: 'org-1' }),
      );
    });

    it('provisions the chart of accounts so the tenant can take its first deposit immediately (D-065)', async () => {
      const { service, prisma, ledger } = build();
      (prisma.subscriptionPlan as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'plan-1',
        code: 'pro',
      });
      (prisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);
      (prisma.organization as { create: jest.Mock }).create.mockResolvedValue({ id: 'org-1', name: dto.name });
      (prisma.organizationSubscription as { create: jest.Mock }).create.mockResolvedValue({});
      (prisma.store as { create: jest.Mock }).create.mockResolvedValue({});
      (prisma.user as { create: jest.Mock }).create.mockResolvedValue({});
      (prisma.organization as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'org-1',
        name: dto.name,
      });

      await service.createOrganization('actor-1', dto as never);

      expect(ledger.ensureChartOfAccounts).toHaveBeenCalledWith('org-1');
    });
  });

  describe('updateOrganization (PA-4)', () => {
    it('labels a status change to suspended distinctly from a plain update', async () => {
      const { service, prisma, featureGate, audit } = build();
      (prisma.organization as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org',
        status: 'active',
      });
      (prisma.organization as { update: jest.Mock }).update.mockResolvedValue({
        id: 'org-1',
        name: 'Org',
        status: 'suspended',
      });

      await service.updateOrganization('actor-1', 'org-1', { status: 'suspended' } as never);

      expect(featureGate.invalidate).toHaveBeenCalledWith('org-1');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'platform.organization_suspended' }),
      );
    });

    it('uses the generic updated action for a non-status-suspending change', async () => {
      const { service, prisma, audit } = build();
      (prisma.organization as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'org-1',
        name: 'Org',
        status: 'active',
      });
      (prisma.organization as { update: jest.Mock }).update.mockResolvedValue({
        id: 'org-1',
        name: 'New Name',
        status: 'active',
      });

      await service.updateOrganization('actor-1', 'org-1', { name: 'New Name' } as never);

      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform.organization_updated' }));
    });
  });

  describe('changeSubscription (PA-4, PA-6)', () => {
    it('throws when the organization has no subscription to change', async () => {
      const { service, prisma } = build();
      (prisma.organizationSubscription as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);
      await expect(service.changeSubscription('actor-1', 'org-1', {} as never)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('resolves planCode to a planId when planId is not given directly', async () => {
      const { service, prisma } = build();
      (prisma.organizationSubscription as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'sub-1',
        status: 'active',
        plan: { code: 'basic' },
      });
      (prisma.subscriptionPlan as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'plan-pro',
        code: 'pro',
      });
      (prisma.organizationSubscription as { update: jest.Mock }).update.mockResolvedValue({
        id: 'sub-1',
        status: 'active',
        plan: { code: 'pro' },
      });

      await service.changeSubscription('actor-1', 'org-1', { planCode: 'pro' } as never);

      expect((prisma.organizationSubscription as { update: jest.Mock }).update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ planId: 'plan-pro' }) }),
      );
    });

    it('rejects an unknown planCode', async () => {
      const { service, prisma } = build();
      (prisma.organizationSubscription as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'sub-1',
        status: 'active',
        plan: { code: 'basic' },
      });
      (prisma.subscriptionPlan as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);
      await expect(
        service.changeSubscription('actor-1', 'org-1', { planCode: 'nope' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('invalidates the feature cache after any successful change', async () => {
      const { service, prisma, featureGate } = build();
      (prisma.organizationSubscription as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'sub-1',
        status: 'active',
        plan: { code: 'basic' },
      });
      (prisma.organizationSubscription as { update: jest.Mock }).update.mockResolvedValue({
        id: 'sub-1',
        status: 'suspended',
        plan: { code: 'basic' },
      });

      await service.changeSubscription('actor-1', 'org-1', { status: 'suspended' } as never);

      expect(featureGate.invalidate).toHaveBeenCalledWith('org-1');
    });
  });

  describe('impersonate (PA-5)', () => {
    it('throws when the organization has no active HQ admin', async () => {
      const { service, prisma } = build();
      (prisma.user as { findFirst: jest.Mock }).findFirst.mockResolvedValue(null);
      await expect(service.impersonate('actor-1', 'org-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('mints a staff-typed, impersonator-tagged token capped at the configured TTL and audits under actorType impersonation', async () => {
      const { service, prisma, tokens, audit } = build();
      (prisma.user as { findFirst: jest.Mock }).findFirst.mockResolvedValue({ id: 'hq-user-1' });

      const result = await service.impersonate('actor-1', 'org-1', '127.0.0.1');

      expect(tokens.signAccessToken).toHaveBeenCalledWith(
        { sub: 'hq-user-1', typ: 'staff', orgId: 'org-1', impersonatorId: 'actor-1' },
        1800,
      );
      expect(result).toEqual({ accessToken: 'signed.jwt.token', expiresIn: 1800, impersonatedUserId: 'hq-user-1' });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ actorType: 'impersonation', action: 'platform.impersonation_started' }),
      );
    });
  });

  describe('platform admin accounts (D-060)', () => {
    it('rejects creating a platform admin with an email already in use', async () => {
      const { service, prisma } = build();
      (prisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.createPlatformAdmin('actor-1', { email: 'a@b.com', password: 'x', adminLevel: 'support' } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates the user with a null organizationId and links a PlatformAdmin row', async () => {
      const { service, prisma, audit } = build();
      (prisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);
      (prisma.user as { create: jest.Mock }).create.mockResolvedValue({ id: 'new-user' });
      (prisma.platformAdmin as { create: jest.Mock }).create.mockResolvedValue({
        id: 'admin-1',
        adminLevel: 'billing',
        user: { id: 'new-user', email: 'billing@example.test' },
      });

      await service.createPlatformAdmin(
        'actor-1',
        { email: 'Billing@Example.Test', password: 'x', adminLevel: 'billing' } as never,
        '127.0.0.1',
      );

      expect((prisma.user as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'billing@example.test' }),
        }),
      );
      expect((prisma.user as { create: jest.Mock }).create.mock.calls[0][0].data.organizationId).toBeUndefined();
      expect((prisma.platformAdmin as { create: jest.Mock }).create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: 'new-user', adminLevel: 'billing' } }),
      );
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'platform.admin_created' }));
    });

    it('rejects a super_admin deactivating their own access', async () => {
      const { service, prisma } = build();
      (prisma.platformAdmin as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'admin-1',
        userId: 'actor-1',
        adminLevel: 'super_admin',
        isActive: true,
      });
      await expect(
        service.updatePlatformAdmin('actor-1', 'admin-1', { isActive: false } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('allows deactivating a different admin', async () => {
      const { service, prisma, audit } = build();
      (prisma.platformAdmin as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
        id: 'admin-2',
        userId: 'other-user',
        adminLevel: 'support',
        isActive: true,
      });
      (prisma.platformAdmin as { update: jest.Mock }).update.mockResolvedValue({
        id: 'admin-2',
        adminLevel: 'support',
        isActive: false,
        user: {},
      });

      await service.updatePlatformAdmin('actor-1', 'admin-2', { isActive: false } as never);

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'platform.admin_updated',
          oldValue: { adminLevel: 'support', isActive: true },
          newValue: { adminLevel: 'support', isActive: false },
        }),
      );
    });

    it('throws when the target platform admin does not exist', async () => {
      const { service, prisma } = build();
      (prisma.platformAdmin as { findUnique: jest.Mock }).findUnique.mockResolvedValue(null);
      await expect(
        service.updatePlatformAdmin('actor-1', 'missing', { isActive: false } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getMetrics', () => {
    it('aggregates org/subscription status counts, totals, and an MRR estimate from active/trialing plans only', async () => {
      const { service, prisma } = build();
      (prisma.organization as { groupBy: jest.Mock }).groupBy.mockResolvedValue([
        { status: 'active', _count: { _all: 3 } },
        { status: 'suspended', _count: { _all: 1 } },
      ]);
      (prisma.organizationSubscription as { groupBy: jest.Mock }).groupBy.mockResolvedValue([
        { status: 'active', _count: { _all: 2 } },
        { status: 'trialing', _count: { _all: 1 } },
      ]);
      (prisma.store as { count: jest.Mock }).count.mockResolvedValue(10);
      (prisma.user as { count: jest.Mock }).count.mockResolvedValue(25);
      (prisma.organization as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { id: 'org-1', name: 'Org 1', createdAt: new Date(), subscription: { plan: { name: 'Pro' } } },
      ]);
      (prisma.organizationSubscription as { findMany: jest.Mock }).findMany.mockResolvedValue([
        { plan: { monthlyPrice: 499 } },
        { plan: { monthlyPrice: 1499 } },
        { plan: { monthlyPrice: null } },
      ]);

      const metrics = await service.getMetrics();

      expect(metrics.organizations).toEqual({ total: 4, byStatus: { active: 3, suspended: 1 } });
      expect(metrics.subscriptions.byStatus).toEqual({ active: 2, trialing: 1 });
      expect(metrics.stores).toBe(10);
      expect(metrics.users).toBe(25);
      expect(metrics.estimatedMonthlyRecurringRevenueSar).toBe(1998);
      expect(metrics.recentSignups).toEqual([
        expect.objectContaining({ id: 'org-1', name: 'Org 1', plan: 'Pro' }),
      ]);
    });
  });

  describe('listAuditLogs', () => {
    it('clamps page and pageSize into sane bounds', async () => {
      const { service, prisma } = build();
      (prisma.auditLog as { findMany: jest.Mock }).findMany.mockResolvedValue([]);
      (prisma.auditLog as { count: jest.Mock }).count.mockResolvedValue(0);

      const result = await service.listAuditLogs({ page: -5, pageSize: 500 });

      expect(result.meta).toEqual({ page: 1, pageSize: 100, total: 0 });
    });

    it('filters by organizationId and a substring action match', async () => {
      const { service, prisma } = build();
      (prisma.auditLog as { findMany: jest.Mock }).findMany.mockResolvedValue([]);
      (prisma.auditLog as { count: jest.Mock }).count.mockResolvedValue(0);

      await service.listAuditLogs({ organizationId: 'org-1', action: 'organization_created' });

      expect((prisma.auditLog as { findMany: jest.Mock }).findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', action: { contains: 'organization_created' } },
        }),
      );
    });
  });
});
