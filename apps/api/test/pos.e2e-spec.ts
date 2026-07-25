import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * The counter transaction end to end (v4 Phases 1–5) against a live database.
 * Requires docker services plus `npm run db:seed`.
 */
describe('POS checkout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let storeId: string;
  let customerId: string;
  let batchId: string;
  const createdOrderIds: string[] = [];

  const auth = () => ({ Authorization: `Bearer ${token}`, 'X-Store-Id': storeId });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@alanwar.example', password: 'Tailonix@Dev1' })
      .expect(200);
    token = login.body.accessToken;
    storeId = login.body.stores.find((s: { isHeadquarters: boolean }) => !s.isHeadquarters).id;

    const customer = await prisma.customer.findFirstOrThrow({
      where: { organizationId: login.body.user.organization.id },
    });
    customerId = customer.id;

    // A roll with plenty of headroom so stock is never the failing condition
    const batch = await prisma.inventoryBatch.findFirstOrThrow({
      where: { storeId, status: 'available' },
    });
    batchId = batch.id;
    await prisma.inventoryBatch.update({
      where: { id: batchId },
      data: { currentQuantity: 200, reservedQuantity: 0 },
    });

    // Guarantee an active profile carrying M1 and M3
    await prisma.measurement.updateMany({
      where: { customerId, garmentType: 'Thobe' },
      data: { isActive: false },
    });
    const last = await prisma.measurement.findFirst({
      where: { customerId, garmentType: 'Thobe' },
      orderBy: { version: 'desc' },
    });
    await prisma.measurement.create({
      data: {
        customerId,
        garmentType: 'Thobe',
        version: (last?.version ?? 0) + 1,
        isActive: true,
        m1TotalLength: 150,
        m3SleeveLength: 62,
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
    await app.close();
  }, 30_000);

  it('looks a customer up by phone with their active frames', async () => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const res = await request(app.getHttpServer())
      .get('/api/v1/pos/lookup')
      .set(auth())
      .query({ phone: customer.phone })
      .expect(200);

    expect(res.body.found).toBe(true);
    expect(res.body.customer.tier).toBeDefined();
    expect(res.body.activeMeasurements.length).toBeGreaterThanOrEqual(1);
  });

  it('reports not-found without leaking anything for an unknown phone', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/pos/lookup')
      .set(auth())
      .query({ phone: '+966500000999' })
      .expect(200);
    expect(res.body.found).toBe(false);
    expect(res.body.customer).toBeUndefined();
  });

  it('previews the yield from the active profile', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/pos/customers/${customerId}/yield`)
      .set(auth())
      .query({ garmentType: 'Thobe', quantity: 3 })
      .expect(200);

    // (1.50 x 2) + 0.62 + 0.20 = 3.82 per garment
    expect(res.body.perGarment).toBe('3.82');
    expect(res.body.totalMeters).toBe('11.46');
  });

  it('checks out three garments: reserves fabric, splits tickets, issues ZATCA', async () => {
    const before = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set(auth())
      .send({
        customerId,
        depositAmount: 600,
        depositMethod: 'card',
        items: [
          { garmentType: 'Thobe', fabricBatchId: batchId, unitPrice: 400, collarStyle: 'qallabi_2_button', cuffStyle: 'formal_kabak' },
          { garmentType: 'Thobe', fabricBatchId: batchId, unitPrice: 400, collarStyle: 'rounded_sada', cuffStyle: 'buttoned_sada' },
          { garmentType: 'Thobe', fabricBatchId: batchId, unitPrice: 400, collarStyle: 'open_v_neck', cuffStyle: 'formal_kabak' },
        ],
      })
      .expect(201);
    createdOrderIds.push(res.body.id);

    expect(res.body.totalAmount).toBe('1200.00');
    expect(res.body.tickets).toHaveLength(3);
    expect(res.body.totalReservedMeters).toBe('11.46');

    // Regression: the response must reflect the deposit, not the pre-update row.
    // Returning the stale order printed a receipt claiming the full amount was due.
    expect(res.body.paidAmount).toBe('600.00');
    expect(res.body.balanceDue).toBe('600.00');

    // Fabric is held, not yet cut
    const after = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(after.currentQuantity.toFixed(2)).toBe(before.currentQuantity.toFixed(2));
    expect(after.reservedQuantity.toFixed(2)).toBe('11.46');

    // 15% VAT split on the tax document
    expect(res.body.invoice.netAmount).toBe('1043.48');
    expect(res.body.invoice.vatAmount).toBe('156.52');
    expect(res.body.invoice.totalAmount).toBe('1200.00');
    expect(res.body.invoice.qrCodeBase64).toBeTruthy();
  });

  it('deducts fabric only when the ticket leaves the cutting station', async () => {
    const orderId = createdOrderIds[0];
    const ticket = await prisma.productionTicket.findFirstOrThrow({ where: { orderId } });
    const before = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });

    await request(app.getHttpServer())
      .put(`/api/v1/workshop/tickets/${ticket.id}/station`)
      .set(auth())
      .send({ toStation: 'cutting' })
      .expect(200);

    // Still only reserved while it sits at the cutting table
    const during = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(during.currentQuantity.toFixed(2)).toBe(before.currentQuantity.toFixed(2));

    await request(app.getHttpServer())
      .put(`/api/v1/workshop/tickets/${ticket.id}/station`)
      .set(auth())
      .send({ toStation: 'stitching' })
      .expect(200);

    const after = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(before.currentQuantity.minus(after.currentQuantity).toFixed(2)).toBe('3.82');
    expect(before.reservedQuantity.minus(after.reservedQuantity).toFixed(2)).toBe('3.82');
  });

  it('refuses to skip stations', async () => {
    const orderId = createdOrderIds[0];
    const queued = await prisma.productionTicket.findFirstOrThrow({
      where: { orderId, station: 'queued' },
    });
    await request(app.getHttpServer())
      .put(`/api/v1/workshop/tickets/${queued.id}/station`)
      .set(auth())
      .send({ toStation: 'quality' })
      .expect(400);
  });

  it('rejects a roll that would be stranded below its minimum', async () => {
    // 5m left, 3.82m needed → 1.18m remainder, under the 3.50m floor
    await prisma.inventoryBatch.update({
      where: { id: batchId },
      data: { currentQuantity: 5, reservedQuantity: 0, minUsableMeters: 3.5 },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set(auth())
      .send({
        customerId,
        items: [{ garmentType: 'Thobe', fabricBatchId: batchId, unitPrice: 400 }],
      })
      .expect(422);

    expect(res.body.message).toMatch(/minimum/i);
    await prisma.inventoryBatch.update({
      where: { id: batchId },
      data: { currentQuantity: 200, reservedQuantity: 0 },
    });
  });

  it('settles the balance at handover', async () => {
    const orderId = createdOrderIds[0];
    const res = await request(app.getHttpServer())
      .post(`/api/v1/pos/orders/${orderId}/settle`)
      .set(auth())
      .send({ amount: 600, method: 'cash' })
      .expect(201);

    expect(res.body.balanceDue).toBe('0.00');
    expect(res.body.depositRealised).toBe('600.00');
  });

  it('refuses to take more than the outstanding balance', async () => {
    const orderId = createdOrderIds[0];
    await request(app.getHttpServer())
      .post(`/api/v1/pos/orders/${orderId}/settle`)
      .set(auth())
      .send({ amount: 100 })
      .expect(400);
  });
});
