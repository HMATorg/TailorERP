import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Covers two things end to end that only an integration test can prove:
 *
 *  - D-046: the counter (cashier role) can register a walk-in and take their
 *    first measurement without a manager or the admin app in the loop —
 *    proving the *guard* resolves the new grant, not just the pure
 *    permission-set function in permissions.spec.ts.
 *  - D-047: the login response and GET /customers/:id carry everything the
 *    admin oversight view and the Print Center actually read (VAT number,
 *    visit history, recent orders).
 *
 * Requires docker services plus `npm run db:seed` (and a cashier.jeddah@…
 * seed account, added alongside this feature).
 */
describe('Customers (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let cashierToken: string;
  let storeId: string;
  let orgId: string;
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const admin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    adminToken = admin.body.accessToken;
    orgId = admin.body.user.organization.id;
    storeId = admin.body.stores.find((s: { isHeadquarters: boolean }) => !s.isHeadquarters).id;

    const cashier = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'cashier.jeddah@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    cashierToken = cashier.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    for (const id of createdCustomerIds) {
      await prisma.measurement.deleteMany({ where: { customerId: id } });
      await prisma.customerStoreVisit.deleteMany({ where: { customerId: id } });
      await prisma.customer.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  }, 30_000);

  it('carries the seller VAT registration on login, for print surfaces (D-047)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    expect(res.body.user.organization).toEqual(
      expect.objectContaining({ id: orgId, name: expect.any(String) }),
    );
    // vatNumber/taxId may be null on the seed org, but the keys must be present
    // — that's what a client checks for, not just their truthiness.
    expect('vatNumber' in res.body.user.organization).toBe(true);
    expect('taxId' in res.body.user.organization).toBe(true);
  });

  it('lets the counter register a walk-in with no admin involvement (D-046)', async () => {
    const phone = `+9665${Date.now().toString().slice(-8)}`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set({ Authorization: `Bearer ${cashierToken}`, 'X-Store-Id': storeId })
      .send({ fullName: 'Walk-in Test Customer', phone, whatsappConsent: false })
      .expect(201);
    createdCustomerIds.push(res.body.id);
    expect(res.body.fullName).toBe('Walk-in Test Customer');
    expect(res.body.phone).toBe(phone);
  });

  it('lets the counter take that new customer’s first measurement (D-046)', async () => {
    const phone = `+9665${(Date.now() + 1).toString().slice(-8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set({ Authorization: `Bearer ${cashierToken}`, 'X-Store-Id': storeId })
      .send({ fullName: 'Walk-in Measured', phone })
      .expect(201);
    createdCustomerIds.push(created.body.id);

    const res = await request(app.getHttpServer())
      .post(`/api/v1/customers/${created.body.id}/measurements`)
      .set({ Authorization: `Bearer ${cashierToken}`, 'X-Store-Id': storeId })
      .send({ garmentType: 'Thobe', m1TotalLength: 148, m3SleeveLength: 60 })
      .expect(201);
    expect(res.body.version).toBe(1);
    expect(res.body.isActive).toBe(true);
  });

  it('rejects a duplicate phone within the org, whoever registers it', async () => {
    const phone = `+9665${(Date.now() + 2).toString().slice(-8)}`;
    const first = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set({ Authorization: `Bearer ${cashierToken}`, 'X-Store-Id': storeId })
      .send({ fullName: 'First', phone })
      .expect(201);
    createdCustomerIds.push(first.body.id);

    await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set({ Authorization: `Bearer ${cashierToken}`, 'X-Store-Id': storeId })
      .send({ fullName: 'Second', phone })
      .expect(409);
  });

  it('returns the full record — visits, recent orders, counts — for HQ oversight (D-047)', async () => {
    const phone = `+9665${(Date.now() + 3).toString().slice(-8)}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set({ Authorization: `Bearer ${cashierToken}`, 'X-Store-Id': storeId })
      .send({ fullName: 'Full Record Test', phone })
      .expect(201);
    createdCustomerIds.push(created.body.id);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/customers/${created.body.id}`)
      .set({ Authorization: `Bearer ${adminToken}`, 'X-Store-Id': storeId })
      .expect(200);

    expect(res.body.fullName).toBe('Full Record Test');
    // Registering at a store writes a visit row (customers.service.ts create()).
    expect(res.body.visits).toEqual([
      expect.objectContaining({ store: expect.objectContaining({ id: storeId }) }),
    ]);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body._count).toEqual(expect.objectContaining({ orders: 0, appointments: 0 }));
  });

  it('404s on a customer id outside the organisation', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/customers/00000000-0000-4000-8000-000000000000')
      .set({ Authorization: `Bearer ${adminToken}`, 'X-Store-Id': storeId })
      .expect(404);
  });
});
