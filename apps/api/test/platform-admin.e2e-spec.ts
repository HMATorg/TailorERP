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

  it('exposes the platform-wide audit log', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs')
      .set(auth())
      .query({ action: 'platform.organization_created' })
      .expect(200);

    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(res.body.items[0].action).toBe('platform.organization_created');
  });
});
