import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Business profile — name, VAT/CR/license numbers, logo — printed on every
 * thermal receipt and A4 tax invoice (D-069). `manage_organization` gate
 * matches the existing ZATCA-onboarding precedent (D-058): hq_admin only.
 * Requires docker services plus `npm run db:seed`.
 */
describe('Organization profile (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hqToken: string;
  let managerToken: string;
  let orgId: string;

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
    orgId = hq.body.user.organization.id;

    const manager = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'manager.jeddah@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    managerToken = manager.body.accessToken;
  }, 60_000);

  afterAll(async () => {
    // Restore the seeded profile so this suite is re-runnable and doesn't
    // leave test data behind for other suites/manual sessions to trip over.
    await prisma.organization.update({
      where: { id: orgId },
      data: { crNumber: null, licenseNumber: null, receiptNote: null, logoUrl: null },
    });
    await app.close();
  });

  it('refuses a store_manager, and rejects unauthenticated, on both routes', async () => {
    const auth = { Authorization: `Bearer ${managerToken}` };
    await request(app.getHttpServer()).get('/api/v1/organization').set(auth).expect(403);
    await request(app.getHttpServer()).put('/api/v1/organization').set(auth).send({ name: 'x' }).expect(403);
    await request(app.getHttpServer()).get('/api/v1/organization').expect(401);
  });

  it('lets an hq_admin read the current profile', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .expect(200);
    expect(res.body.name).toEqual(expect.any(String));
  });

  it('round-trips CR number, license number, and a logo data URI', async () => {
    const logoUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const put = await request(app.getHttpServer())
      .put('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .send({ crNumber: '1010101010', licenseNumber: '7-00-123456', logoUrl })
      .expect(200);
    expect(put.body.crNumber).toBe('1010101010');
    expect(put.body.licenseNumber).toBe('7-00-123456');
    expect(put.body.logoUrl).toBe(logoUrl);

    const get = await request(app.getHttpServer())
      .get('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .expect(200);
    expect(get.body.crNumber).toBe('1010101010');
    expect(get.body.logoUrl).toBe(logoUrl);
  });

  it('clears the logo when logoUrl is sent as null', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .send({ logoUrl: null })
      .expect(200);

    const get = await request(app.getHttpServer())
      .get('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .expect(200);
    expect(get.body.logoUrl).toBeNull();
  });

  it('rejects a logoUrl that is not an image data URI', async () => {
    await request(app.getHttpServer())
      .put('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .send({ logoUrl: 'https://example.com/logo.png' })
      .expect(400);
  });

  it('round-trips the thermal-receipt note and rejects one over 500 characters (D-072)', async () => {
    const note = 'Not responsible for garments left unclaimed after 3 months.';
    const put = await request(app.getHttpServer())
      .put('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .send({ receiptNote: note })
      .expect(200);
    expect(put.body.receiptNote).toBe(note);

    const get = await request(app.getHttpServer())
      .get('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .expect(200);
    expect(get.body.receiptNote).toBe(note);

    await request(app.getHttpServer())
      .put('/api/v1/organization')
      .set({ Authorization: `Bearer ${hqToken}` })
      .send({ receiptNote: 'x'.repeat(501) })
      .expect(400);
  });
});
