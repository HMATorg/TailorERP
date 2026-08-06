import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * Per-shop button catalog (D-071): admin feeds a photographed button, POS
 * picks from it at checkout. `manage_organization` gates writes (hq_admin
 * only), `use_pos` gates the read-only list any till can pick from — same
 * split as the D-069 organization profile precedent. Requires docker
 * services plus `npm run db:seed`.
 */
describe('Buttons catalog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hqToken: string;
  let managerToken: string;
  let storeId: string;
  let customerId: string;
  let batchId: string;
  const createdButtonIds: string[] = [];
  const createdOrderIds: string[] = [];

  const hqAuth = () => ({ Authorization: `Bearer ${hqToken}` });
  const posAuth = () => ({ Authorization: `Bearer ${managerToken}`, 'X-Store-Id': storeId });

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

    const manager = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'manager.jeddah@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    managerToken = manager.body.accessToken;
    storeId = manager.body.stores.find((s: { isHeadquarters: boolean }) => !s.isHeadquarters).id;

    const customer = await prisma.customer.findFirstOrThrow({
      where: { organizationId: hq.body.user.organization.id },
    });
    customerId = customer.id;

    const batch = await prisma.inventoryBatch.findFirstOrThrow({ where: { storeId, status: 'available' } });
    batchId = batch.id;
    await prisma.inventoryBatch.update({ where: { id: batchId }, data: { currentQuantity: 200, reservedQuantity: 0 } });

    await prisma.measurement.updateMany({ where: { customerId, garmentType: 'Thobe' }, data: { isActive: false } });
    const last = await prisma.measurement.findFirst({ where: { customerId, garmentType: 'Thobe' }, orderBy: { version: 'desc' } });
    await prisma.measurement.create({
      data: {
        customerId,
        garmentType: 'Thobe',
        version: (last?.version ?? 0) + 1,
        isActive: true,
        m1FrontLength: 150,
        m1BackLength: 150,
        m3SleeveLeft: 62,
        m3SleeveRight: 62,
      },
    });
  }, 60_000);

  afterAll(async () => {
    for (const id of createdOrderIds) {
      await prisma.fabricReservation.deleteMany({ where: { orderItem: { orderId: id } } });
      await prisma.productionTicketHistory.deleteMany({ where: { ticket: { orderId: id } } });
      await prisma.productionTicket.deleteMany({ where: { orderId: id } });
      await prisma.orderItemFabric.deleteMany({ where: { orderItem: { orderId: id } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: id } });
      await prisma.orderItem.deleteMany({ where: { orderId: id } });
      await prisma.payment.deleteMany({ where: { orderId: id } });
      await prisma.invoice.deleteMany({ where: { orderId: id } });
      await prisma.inventoryMovement.deleteMany({ where: { orderId: id } });
      await prisma.order.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.buttonDesign.deleteMany({ where: { id: { in: createdButtonIds } } });
    await app.close();
  }, 30_000);

  it('refuses a store_manager write, and rejects unauthenticated, but allows store_manager to list', async () => {
    await request(app.getHttpServer()).post('/api/v1/buttons').set(posAuth()).send({ serialNumber: '900', imageUrl: PNG }).expect(403);
    await request(app.getHttpServer()).get('/api/v1/buttons').expect(401);
    await request(app.getHttpServer()).get('/api/v1/buttons').set(posAuth()).expect(200);
  });

  it('lets an hq_admin create a button and rejects a duplicate serial in the same org', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/buttons')
      .set(hqAuth())
      .send({ serialNumber: '901', label: 'Pearl round', imageUrl: PNG })
      .expect(201);
    createdButtonIds.push(created.body.id);
    expect(created.body.serialNumber).toBe('901');
    expect(created.body.imageUrl).toBe(PNG);

    await request(app.getHttpServer())
      .post('/api/v1/buttons')
      .set(hqAuth())
      .send({ serialNumber: '901', imageUrl: PNG })
      .expect(409);
  });

  it('rejects an imageUrl that is not an image data URI', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/buttons')
      .set(hqAuth())
      .send({ serialNumber: '902', imageUrl: 'https://example.com/button.png' })
      .expect(400);
  });

  it('lists only active buttons by default, includes inactive with the query flag', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/buttons')
      .set(hqAuth())
      .send({ serialNumber: '903', imageUrl: PNG })
      .expect(201);
    createdButtonIds.push(created.body.id);

    await request(app.getHttpServer())
      .put(`/api/v1/buttons/${created.body.id}`)
      .set(hqAuth())
      .send({ isActive: false })
      .expect(200);

    const activeOnly = await request(app.getHttpServer()).get('/api/v1/buttons').set(posAuth()).expect(200);
    expect(activeOnly.body.some((b: { id: string }) => b.id === created.body.id)).toBe(false);

    const withInactive = await request(app.getHttpServer())
      .get('/api/v1/buttons')
      .set(posAuth())
      .query({ includeInactive: 'true' })
      .expect(200);
    expect(withInactive.body.some((b: { id: string }) => b.id === created.body.id)).toBe(true);
  });

  it('carries a selected buttonDesignId through checkout onto the order item', async () => {
    const button = await request(app.getHttpServer())
      .post('/api/v1/buttons')
      .set(hqAuth())
      .send({ serialNumber: '904', label: 'Kuwaiti classic', imageUrl: PNG })
      .expect(201);
    createdButtonIds.push(button.body.id);

    const res = await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set(posAuth())
      .send({
        customerId,
        items: [{ garmentType: 'Thobe', fabricBatchId: batchId, unitPrice: 400, buttonDesignId: button.body.id }],
      })
      .expect(201);
    createdOrderIds.push(res.body.id);

    const order = await request(app.getHttpServer()).get(`/api/v1/orders/${res.body.id}`).set(posAuth()).expect(200);
    expect(order.body.items[0].buttonDesign).toEqual(
      expect.objectContaining({ id: button.body.id, serialNumber: '904', label: 'Kuwaiti classic' }),
    );
  });

  it('rejects checkout with a buttonDesignId from another organization', async () => {
    const foreignOrg = await prisma.organization.create({ data: { name: 'Buttons E2E Foreign Org' } });
    const foreign = await prisma.buttonDesign.create({
      data: { organizationId: foreignOrg.id, serialNumber: 'f-1', imageUrl: PNG },
    });

    await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set(posAuth())
      .send({
        customerId,
        items: [{ garmentType: 'Thobe', fabricBatchId: batchId, unitPrice: 400, buttonDesignId: foreign.id }],
      })
      .expect(400);

    await prisma.buttonDesign.delete({ where: { id: foreign.id } });
    await prisma.organization.delete({ where: { id: foreignOrg.id } });
  });
});
