import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MailerService } from '../src/notifications/mailer.service';
import { ReorderCronService } from '../src/notifications/reorder-cron.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Covers the reorder cron → alert → email digest path (PRD I-4, I-5)
 * and the staff invitation email (HQ-4) against a live database.
 */
describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cron: ReorderCronService;
  let sent: { to: string; subject: string }[];
  let storeId: string;
  let orgId: string;
  let staffToken: string;
  const fabric = `E2E Test Fabric ${Date.now()}`;
  const createdBatchIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    cron = app.get(ReorderCronService);

    // Capture mail instead of sending it
    sent = [];
    const mailer = app.get(MailerService);
    jest.spyOn(mailer, 'send').mockImplementation(async (m) => {
      sent.push({ to: m.to, subject: m.subject });
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    staffToken = login.body.accessToken;
    orgId = login.body.user.organization.id;
    storeId = login.body.stores.find((s: { isHeadquarters: boolean }) => !s.isHeadquarters).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.inventoryMovement.deleteMany({ where: { batchId: { in: createdBatchIds } } });
    await prisma.inventoryBatch.deleteMany({ where: { id: { in: createdBatchIds } } });
    await prisma.inventoryRestockAlert.deleteMany({ where: { storeId, fabricName: fabric } });
    await prisma.inventoryReorderSetting.deleteMany({ where: { storeId, fabricName: fabric } });
    await prisma.invitation.deleteMany({ where: { email: { contains: 'e2e-invite-' } } });
    await app.close();
  }, 30_000);

  it('creates a restock alert and emails managers when stock falls below threshold', async () => {
    // 5 metres in stock against a minimum of 20 → must alert
    const batch = await prisma.inventoryBatch.create({
      data: {
        storeId,
        fabricName: fabric,
        batchCode: `E2E-${Date.now()}`,
        initialQuantity: 5,
        currentQuantity: 5,
        costPricePerUnit: 10,
        purchaseDate: new Date(),
      },
    });
    createdBatchIds.push(batch.id);
    await prisma.inventoryReorderSetting.create({
      data: { storeId, fabricName: fabric, minThreshold: 20, maxThreshold: 100 },
    });

    sent.length = 0;
    const created = await cron.checkStore(storeId);
    expect(created).toBeGreaterThanOrEqual(1);

    const alert = await prisma.inventoryRestockAlert.findFirst({
      where: { storeId, fabricName: fabric, status: 'pending' },
    });
    expect(alert).toBeTruthy();
    expect(Number(alert!.currentQty)).toBe(5);
    expect(Number(alert!.thresholdQty)).toBe(20);
    // suggested = max - current
    expect(Number(alert!.suggestedOrderQty)).toBe(95);

    // HQ admin and the branch store manager should both be notified
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.some((m) => m.to === 'owner@alanwar.example')).toBe(true);
    expect(sent.some((m) => m.to === 'manager.jeddah@alanwar.example')).toBe(true);
    expect(sent[0].subject).toContain('Low stock');
  });

  it('does not duplicate an alert that is already open', async () => {
    sent.length = 0;
    const created = await cron.checkStore(storeId);

    const alerts = await prisma.inventoryRestockAlert.findMany({
      where: { storeId, fabricName: fabric, status: 'pending' },
    });
    expect(alerts).toHaveLength(1);
    expect(created).toBe(0);
    expect(sent).toHaveLength(0); // no alerts created → no digest
  });

  it('sends an invitation email with an accept link', async () => {
    sent.length = 0;
    const email = `e2e-invite-${Date.now()}@example.test`;

    const res = await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set({ Authorization: `Bearer ${staffToken}` })
      .send({ email, fullName: 'E2E Invitee', assignments: [{ storeId, role: 'tailor' }] })
      .expect(201);

    expect(res.body.devAcceptToken).toBeDefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(email);
    expect(sent[0].subject).toContain('invited you to');
  });

  it('keeps the org scoped: alerts only reach the right organisation', async () => {
    const alert = await prisma.inventoryRestockAlert.findFirst({
      where: { storeId, fabricName: fabric },
      include: { store: { select: { organizationId: true } } },
    });
    expect(alert!.store.organizationId).toBe(orgId);
  });
});
