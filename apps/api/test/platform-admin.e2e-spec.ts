import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Exercises the Platform Admin API (PRD §4.5) against a live database.
 * Requires docker compose services; run `npm run db:migrate && npm run db:seed` first.
 */
describe('Platform Admin API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  const createdOrgIds: string[] = [];
  const createdAdminUserIds: string[] = [];
  const suffix = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: 'admin@tailonix.com', password: 'Tailonix@Dev1' })
      .expect(200);
    token = res.body.accessToken;
    expect(res.body.user.adminLevel).toBe('super_admin');
  }, 60_000);

  afterAll(async () => {
    for (const userId of createdAdminUserIds) {
      await prisma.platformAdmin.deleteMany({ where: { userId } });
      await prisma.auditLog.deleteMany({ where: { actorUserId: userId } });
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    for (const orgId of createdOrgIds) {
      await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
      await prisma.organizationSubscription.deleteMany({ where: { organizationId: orgId } });
      await prisma.user.deleteMany({ where: { organizationId: orgId } });
      await prisma.store.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => undefined);
    }
    await app.close();
  }, 30_000);

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('rejects unauthenticated access to the admin API', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/organizations').expect(401);
  });

  it('rejects a tenant staff token on the admin API', async () => {
    const staff = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/admin/organizations')
      .set({ Authorization: `Bearer ${staff.body.accessToken}` })
      .expect(403);
  });

  it('lists tenants with plan and counts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/organizations')
      .set(auth())
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const demo = res.body.find((o: { name: string }) => o.name === 'Al Anwar Tailors');
    expect(demo).toBeDefined();
    expect(demo.subscription.plan.code).toBe('enterprise');
    expect(demo._count.stores).toBeGreaterThanOrEqual(2);
  });

  it('provisions a tenant with subscription, HQ store and HQ admin (PA-2)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/organizations')
      .set(auth())
      .send({
        name: `E2E Tailors ${suffix}`,
        planCode: 'pro',
        hqAdminEmail: `e2e-hq-${suffix}@example.test`,
        hqAdminPassword: 'E2ePassw0rd!',
        hqAdminFullName: 'E2E Owner',
      })
      .expect(201);

    createdOrgIds.push(res.body.id);
    expect(res.body.subscription.plan.code).toBe('pro');
    expect(res.body.stores).toHaveLength(1);
    expect(res.body.stores[0].isHeadquarters).toBe(true);

    // The generated HQ admin can sign in to the tenant API
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: `e2e-hq-${suffix}@example.test`, password: 'E2ePassw0rd!' })
      .expect(200);
    expect(login.body.user.orgRole).toBe('hq_admin');

    // The chart of accounts must exist from creation, not depend on someone
    // opening Ledger first — a brand-new tenant's first cash sale used to fail
    // outright with "Ledger account 'cash_on_hand' is not set up" (D-065).
    const accounts = await prisma.ledgerAccount.findMany({ where: { organizationId: res.body.id } });
    expect(accounts.map((a) => a.code).sort()).toEqual(
      ['bank', 'card_clearing', 'cash_on_hand', 'sales_revenue', 'unearned_revenue', 'vat_payable'].sort(),
    );
  });

  it('rejects a duplicate HQ admin email', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/admin/organizations')
      .set(auth())
      .send({
        name: `Duplicate ${suffix}`,
        planCode: 'pro',
        hqAdminEmail: `e2e-hq-${suffix}@example.test`,
        hqAdminPassword: 'E2ePassw0rd!',
      })
      .expect(409);
  });

  it('enforces the plan store limit with 402 (feature gating)', async () => {
    const orgId = createdOrgIds[0];
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    const hqAdmin = await prisma.user.findFirstOrThrow({
      where: { organizationId: orgId, orgRole: 'hq_admin' },
    });
    // Downgrade to Basic (max 1 store); the org already has its HQ store
    await request(app.getHttpServer())
      .put(`/api/v1/admin/organizations/${orgId}/subscription`)
      .set(auth())
      .send({ planCode: 'basic' })
      .expect(200);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: hqAdmin.email, password: 'E2ePassw0rd!' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/stores')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .send({ name: `${org.name} — Second Branch` })
      .expect(402);
  });

  it('gates transfers, regional_managers, and pwa behind the plan feature list (D-060)', async () => {
    // The org from createdOrgIds[0] was downgraded to 'basic' by the previous
    // test — 'basic' carries none of these three features.
    const orgId = createdOrgIds[0];
    const hqAdmin = await prisma.user.findFirstOrThrow({
      where: { organizationId: orgId, orgRole: 'hq_admin' },
    });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: hqAdmin.email, password: 'E2ePassw0rd!' })
      .expect(200);
    const staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };
    const store = await prisma.store.findFirstOrThrow({ where: { organizationId: orgId } });

    await request(app.getHttpServer())
      .post('/api/v1/inventory/transfer')
      .set(staffAuth)
      .set('X-Store-Id', store.id)
      .send({
        batchId: randomUUID(),
        destinationStoreId: randomUUID(),
        quantity: 1,
      })
      .expect(402);

    await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set(staffAuth)
      .send({
        email: `regional-${suffix}@example.test`,
        assignments: [{ storeId: store.id, role: 'regional_manager' }],
      })
      .expect(402);

    const phone = `+96650${suffix.toString().slice(-7)}`;
    await prisma.customer.create({
      data: { organizationId: orgId, phone, fullName: 'PWA Gate Test', isActive: true },
    });
    const otp = await request(app.getHttpServer())
      .post('/api/v1/customer/auth/otp')
      .send({ phone, organizationId: orgId })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/customer/auth/verify')
      .send({ phone, code: otp.body.devCode, organizationId: orgId })
      .expect(402);
  });

  it('suspends a tenant and blocks its staff from logging in (PA-4)', async () => {
    const orgId = createdOrgIds[0];
    const hqAdmin = await prisma.user.findFirstOrThrow({
      where: { organizationId: orgId, orgRole: 'hq_admin' },
    });

    await request(app.getHttpServer())
      .put(`/api/v1/admin/organizations/${orgId}`)
      .set(auth())
      .send({ status: 'suspended' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: hqAdmin.email, password: 'E2ePassw0rd!' })
      .expect(403);

    // Reactivating restores access
    await request(app.getHttpServer())
      .put(`/api/v1/admin/organizations/${orgId}`)
      .set(auth())
      .send({ status: 'active' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: hqAdmin.email, password: 'E2ePassw0rd!' })
      .expect(200);
  });

  it('issues an audited, time-limited impersonation token (PA-5)', async () => {
    const orgId = createdOrgIds[0];

    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/organizations/${orgId}/impersonate`)
      .set(auth())
      .expect(201);

    expect(res.body.expiresIn).toBeLessThanOrEqual(1800); // max 30 minutes
    expect(res.body.impersonatedUserId).toBeDefined();

    // The token actually works against the tenant API
    await request(app.getHttpServer())
      .get('/api/v1/stores')
      .set({ Authorization: `Bearer ${res.body.accessToken}` })
      .expect(200);

    // …and the act was recorded under the impersonator's identity
    const entry = await prisma.auditLog.findFirst({
      where: { organizationId: orgId, action: 'platform.impersonation_started' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect(entry!.actorType).toBe('impersonation');
    expect(entry!.actorUserId).toBeTruthy();
  });

  it('resolves an impersonation token into a full session via GET /auth/session (D-060 handoff)', async () => {
    const orgId = createdOrgIds[0];
    const hqAdmin = await prisma.user.findFirstOrThrow({
      where: { organizationId: orgId, orgRole: 'hq_admin' },
    });

    const impersonation = await request(app.getHttpServer())
      .post(`/api/v1/admin/organizations/${orgId}/impersonate`)
      .set(auth())
      .expect(201);

    const session = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set({ Authorization: `Bearer ${impersonation.body.accessToken}` })
      .expect(200);

    expect(session.body.user.id).toBe(hqAdmin.id);
    expect(session.body.user.email).toBe(hqAdmin.email);
    expect(Array.isArray(session.body.stores)).toBe(true);

    // A platform-typed token (not staff) must not be able to resolve a session this way
    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set(auth())
      .expect(403);
  });

  it('exposes the platform-wide audit log', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs')
      .set(auth())
      .query({ action: 'platform.organization_created' })
      .expect(200);

    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.items[0].action).toBe('platform.organization_created');
  });

  it('creates, lists, and revokes a platform admin account (D-060)', async () => {
    const email = `e2e-platform-admin-${suffix}@example.test`;

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/platform-admins')
      .set(auth())
      .send({ email, password: 'E2ePassw0rd!', fullName: 'E2E Support Agent', adminLevel: 'support' })
      .expect(201);
    createdAdminUserIds.push(created.body.user.id);
    expect(created.body.adminLevel).toBe('support');
    expect(created.body.isActive).toBe(true);

    // The new account can actually log in to the platform app
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email, password: 'E2ePassw0rd!' })
      .expect(200);
    expect(login.body.user.adminLevel).toBe('support');

    // A support-level token cannot reach a super_admin-only route
    await request(app.getHttpServer())
      .post('/api/v1/admin/platform-admins')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .send({ email: `${email}-2`, password: 'E2ePassw0rd!', adminLevel: 'support' })
      .expect(403);

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/platform-admins')
      .set(auth())
      .expect(200);
    expect(list.body.some((a: { user: { email: string } }) => a.user.email === email)).toBe(true);

    // Revoke — the account can no longer log in
    await request(app.getHttpServer())
      .put(`/api/v1/admin/platform-admins/${created.body.id}`)
      .set(auth())
      .send({ isActive: false })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email, password: 'E2ePassw0rd!' })
      .expect(403);
  });

  it('creates a new plan then updates it in place via upsert-by-code (PA-3)', async () => {
    const code = `e2e-plan-${suffix}`;

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/plans')
      .set(auth())
      .send({
        name: 'E2E Starter',
        code,
        maxStores: 1,
        maxUsers: 3,
        features: ['pwa'],
        monthlyPrice: 99,
      })
      .expect(201);
    expect(created.body.maxStores).toBe(1);
    expect(created.body.features).toEqual(['pwa']);

    const updated = await request(app.getHttpServer())
      .post('/api/v1/admin/plans')
      .set(auth())
      .send({
        name: 'E2E Starter Plus',
        code,
        maxStores: 2,
        maxUsers: 5,
        features: ['pwa', 'whatsapp'],
        monthlyPrice: 149,
      })
      .expect(201);
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.name).toBe('E2E Starter Plus');
    expect(updated.body.maxStores).toBe(2);
    expect(updated.body.features).toEqual(['pwa', 'whatsapp']);

    const list = await request(app.getHttpServer())
      .get('/api/v1/admin/plans')
      .set(auth())
      .expect(200);
    expect(list.body.filter((p: { code: string }) => p.code === code)).toHaveLength(1);
  });

  it('upgrades a subscription to a richer plan and immediately grants its features (PA-4)', async () => {
    // createdOrgIds[0] is on 'basic' (downgraded earlier) — upgrade to 'enterprise',
    // the only plan carrying 'transfers', and confirm the feature gate reflects it
    // on the very next request (cache invalidated).
    const orgId = createdOrgIds[0];
    const hqAdmin = await prisma.user.findFirstOrThrow({
      where: { organizationId: orgId, orgRole: 'hq_admin' },
    });

    const res = await request(app.getHttpServer())
      .put(`/api/v1/admin/organizations/${orgId}/subscription`)
      .set(auth())
      .send({ planCode: 'enterprise' })
      .expect(200);
    expect(res.body.plan.code).toBe('enterprise');
    expect(res.body.status).toBe('active');

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: hqAdmin.email, password: 'E2ePassw0rd!' })
      .expect(200);
    const store = await prisma.store.findFirstOrThrow({ where: { organizationId: orgId } });

    // 'transfers' was 402 under 'basic' (see the D-060 gating test above); 'enterprise' grants it.
    const transfer = await request(app.getHttpServer())
      .post('/api/v1/inventory/transfer')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .set('X-Store-Id', store.id)
      .send({ batchId: randomUUID(), destinationStoreId: randomUUID(), quantity: 1 });
    expect(transfer.status).not.toBe(402);
  });

  it('enforces per-route admin-level allow-lists beyond the guard unit tests (D-060)', async () => {
    // Seed a 'support' and a 'billing' platform admin distinct from any created above.
    const supportEmail = `e2e-level-support-${suffix}@example.test`;
    const billingEmail = `e2e-level-billing-${suffix}@example.test`;
    for (const [email, adminLevel] of [
      [supportEmail, 'support'],
      [billingEmail, 'billing'],
    ] as const) {
      const created = await request(app.getHttpServer())
        .post('/api/v1/admin/platform-admins')
        .set(auth())
        .send({ email, password: 'E2ePassw0rd!', adminLevel })
        .expect(201);
      createdAdminUserIds.push(created.body.user.id);
    }

    const supportLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: supportEmail, password: 'E2ePassw0rd!' })
      .expect(200);
    const billingLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email: billingEmail, password: 'E2ePassw0rd!' })
      .expect(200);
    const supportAuth = { Authorization: `Bearer ${supportLogin.body.accessToken}` };
    const billingAuth = { Authorization: `Bearer ${billingLogin.body.accessToken}` };
    const orgId = createdOrgIds[0];

    // organizations: create/update/plans-write are super_admin-only.
    await request(app.getHttpServer())
      .post('/api/v1/admin/organizations')
      .set(billingAuth)
      .send({ name: 'nope', planCode: 'basic', hqAdminEmail: 'x@x.com', hqAdminPassword: 'x'.repeat(8) })
      .expect(403);
    await request(app.getHttpServer())
      .put(`/api/v1/admin/organizations/${orgId}`)
      .set(supportAuth)
      .send({ name: 'nope' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/admin/plans')
      .set(billingAuth)
      .send({ name: 'nope', code: 'nope', maxStores: 1, maxUsers: 1, features: [] })
      .expect(403);

    // subscription changes: billing is allowed, support is not.
    await request(app.getHttpServer())
      .put(`/api/v1/admin/organizations/${orgId}/subscription`)
      .set(supportAuth)
      .send({ status: 'active' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/admin/organizations/${orgId}/subscription`)
      .set(billingAuth)
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/admin/organizations/${orgId}/subscription`)
      .set(billingAuth)
      .send({ status: 'active' })
      .expect(200);

    // impersonation: support is allowed, billing is not.
    await request(app.getHttpServer())
      .post(`/api/v1/admin/organizations/${orgId}/impersonate`)
      .set(billingAuth)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/organizations/${orgId}/impersonate`)
      .set(supportAuth)
      .expect(201);

    // platform-admin account management stays super_admin-only for both.
    await request(app.getHttpServer())
      .get('/api/v1/admin/platform-admins')
      .set(supportAuth)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/admin/platform-admins')
      .set(billingAuth)
      .expect(403);
  });

  it('revokes a platform admin mid-session — an already-issued token stops working on its very next request (D-060)', async () => {
    const email = `e2e-revoke-live-${suffix}@example.test`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/platform-admins')
      .set(auth())
      .send({ email, password: 'E2ePassw0rd!', adminLevel: 'support' })
      .expect(201);
    createdAdminUserIds.push(created.body.user.id);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/platform/login')
      .send({ email, password: 'E2ePassw0rd!' })
      .expect(200);
    const liveAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    // The still-valid, unexpired JWT works right now…
    await request(app.getHttpServer())
      .get('/api/v1/admin/metrics')
      .set(liveAuth)
      .expect(200);

    // …an operator revokes it out-of-band (super_admin action, different actor)…
    await request(app.getHttpServer())
      .put(`/api/v1/admin/platform-admins/${created.body.id}`)
      .set(auth())
      .send({ isActive: false })
      .expect(200);

    // …and the exact same JWT — never expired, never rotated — is rejected on
    // its very next use, because PlatformAdminGuard re-checks the DB every call.
    await request(app.getHttpServer())
      .get('/api/v1/admin/metrics')
      .set(liveAuth)
      .expect(403);
  });

  it('refuses to let a super_admin deactivate their own platform admin access', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/v1/admin/platform-admins')
      .set(auth())
      .expect(200);
    const self = me.body.find((a: { user: { email: string } }) => a.user.email === 'admin@tailonix.com');
    expect(self).toBeDefined();

    await request(app.getHttpServer())
      .put(`/api/v1/admin/platform-admins/${self.id}`)
      .set(auth())
      .send({ isActive: false })
      .expect(400);
  });
});
