import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Tenant self-serve billing (D-062) against a live database: the
 * manage_organization permission gate (hq_admin only, matching D-058's
 * ZATCA-onboarding precedent), and the WhatsApp per-store config write path
 * — specifically that the token never appears in any real HTTP response,
 * not just in the unit-tested sanitizeStore() helper's mocked inputs.
 * Requires docker services plus `npm run db:seed`.
 */
describe('Tenant billing + WhatsApp config (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hqToken: string;
  let managerToken: string;
  let hqStoreId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const hq = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    hqToken = hq.body.accessToken;
    hqStoreId = hq.body.stores.find((s: { isHeadquarters: boolean }) => s.isHeadquarters).id;

    const manager = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'manager.jeddah@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    managerToken = manager.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  describe('manage_organization gate — hq_admin only, matching D-058', () => {
    it('lets an hq_admin read their own plans, subscription, and invoices', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/billing/plans')
        .set({ Authorization: `Bearer ${hqToken}` })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/billing/subscription')
        .set({ Authorization: `Bearer ${hqToken}` })
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/v1/billing/invoices')
        .set({ Authorization: `Bearer ${hqToken}` })
        .expect(200);
    });

    it('refuses a store_manager on every tenant billing route', async () => {
      const auth = { Authorization: `Bearer ${managerToken}` };
      await request(app.getHttpServer()).get('/api/v1/billing/plans').set(auth).expect(403);
      await request(app.getHttpServer()).get('/api/v1/billing/subscription').set(auth).expect(403);
      await request(app.getHttpServer()).get('/api/v1/billing/invoices').set(auth).expect(403);
      await request(app.getHttpServer())
        .post('/api/v1/billing/checkout')
        .set(auth)
        .send({ planCode: 'pro', interval: 'monthly' })
        .expect(403);
      await request(app.getHttpServer()).post('/api/v1/billing/portal').set(auth).expect(403);
    });

    it('rejects an unauthenticated request outright', async () => {
      await request(app.getHttpServer()).get('/api/v1/billing/subscription').expect(401);
    });
  });

  describe('WhatsApp per-store config (D-062)', () => {
    it('round-trips the phone number id but never returns the token in any shape, plaintext or encrypted', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/stores/${hqStoreId}`)
        .set({ Authorization: `Bearer ${hqToken}` })
        .send({ whatsappPhoneNumberId: '999888777', whatsappAccessToken: 'EAA_e2e_secret_token' })
        .expect(200);

      expect(res.body.whatsappPhoneNumberId).toBe('999888777');
      expect(res.body.whatsappConfigured).toBe(true);
      expect(res.body).not.toHaveProperty('whatsappAccessTokenEncrypted');
      expect(res.body).not.toHaveProperty('whatsappAccessToken');
      expect(JSON.stringify(res.body)).not.toContain('EAA_e2e_secret_token');

      // Nor does a plain read of the store afterwards.
      const list = await request(app.getHttpServer())
        .get('/api/v1/stores')
        .set({ Authorization: `Bearer ${hqToken}` })
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain('EAA_e2e_secret_token');

      // The database holds an encrypted envelope, not the plaintext.
      const row = await prisma.store.findUniqueOrThrow({ where: { id: hqStoreId } });
      expect(row.whatsappAccessTokenEncrypted).not.toBeNull();
      expect(row.whatsappAccessTokenEncrypted).not.toContain('EAA_e2e_secret_token');
      expect(row.whatsappAccessTokenEncrypted).toMatch(/^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    });

    it('a store_manager cannot write store config at all (manage_stores, not just manage_organization)', async () => {
      await request(app.getHttpServer())
        .put(`/api/v1/stores/${hqStoreId}`)
        .set({ Authorization: `Bearer ${managerToken}` })
        .send({ whatsappPhoneNumberId: '000' })
        .expect(403);
    });
  });
});
