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

  it('opens a customer picked from the directory by id', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/pos/customers/${customerId}`)
      .set(auth())
      .expect(200);

    expect(res.body.found).toBe(true);
    expect(res.body.customer.id).toBe(customerId);
    expect(res.body.customer.tier).toBeDefined();
    // Same shape as the phone-lookup path — the directory must never show a
    // thinner profile than typing the number in would have.
    expect(res.body.activeMeasurements.length).toBeGreaterThanOrEqual(1);
  });

  it('404s rather than leaking on an id outside the organisation', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/pos/customers/00000000-0000-4000-8000-000000000000')
      .set(auth())
      .expect(404);
  });

  it('directory with no query returns recently-active customers', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/pos/customers')
      .set(auth())
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toEqual(
      expect.objectContaining({ id: expect.any(String), fullName: expect.any(String), tier: expect.any(String) }),
    );
  });

  it('directory search filters by phone digits', async () => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    // A cashier types digits from the phone, not necessarily the full number.
    const digits = customer.phone.slice(-6);

    const res = await request(app.getHttpServer())
      .get('/api/v1/pos/customers')
      .set(auth())
      .query({ search: digits })
      .expect(200);

    expect(res.body.some((c: { id: string }) => c.id === customerId)).toBe(true);
  });

  it('directory search filters by name substring', async () => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const fragment = customer.fullName.slice(0, 4);

    const res = await request(app.getHttpServer())
      .get('/api/v1/pos/customers')
      .set(auth())
      .query({ search: fragment })
      .expect(200);

    expect(res.body.some((c: { id: string }) => c.id === customerId)).toBe(true);
  });

  it('directory search finds nothing for a nonsense query without erroring', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/pos/customers')
      .set(auth())
      .query({ search: 'zzzzznonexistentzzzzz' })
      .expect(200);
    expect(res.body).toEqual([]);
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

  it('yields against the longer of front/back and left/right when the pair is asymmetric (D-068)', async () => {
    const phone = `+9665${(Date.now() + 20).toString().slice(-8)}`;
    const asym = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set(auth())
      .send({ fullName: 'Asymmetric Fit', phone })
      .expect(201);
    await prisma.measurement.create({
      data: {
        customerId: asym.body.id,
        garmentType: 'Thobe',
        version: 1,
        isActive: true,
        m1FrontLength: 148,
        m1BackLength: 155,
        m3SleeveLeft: 58,
        m3SleeveRight: 63,
      },
    });

    const res = await request(app.getHttpServer())
      .get(`/api/v1/pos/customers/${asym.body.id}/yield`)
      .set(auth())
      .query({ garmentType: 'Thobe', quantity: 1 })
      .expect(200);

    // max(148,155)=155, max(58,63)=63 → (1.55 x 2) + 0.63 + 0.20 = 3.93, NOT the
    // shorter-side figure (1.48 x 2) + 0.58 + 0.20 = 3.74 — under-cutting fabric
    // for the longer side would ruin the garment.
    expect(res.body.perGarment).toBe('3.93');
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

    // Carried so Receipt can print a garment tag per ticket without a second
    // round trip; must line up with the item it was actually cut from.
    expect(res.body.tickets.every((t: { garmentType: string }) => t.garmentType === 'Thobe')).toBe(true);
    expect(res.body.customerName).toEqual(expect.any(String));

    // Regression: the response must reflect the deposit, not the pre-update row.
    // Returning the stale order printed a receipt claiming the full amount was due.
    expect(res.body.paidAmount).toBe('600.00');
    expect(res.body.balanceDue).toBe('600.00');
    // The thermal receipt's "Payment method" row reads this directly (D-072).
    expect(res.body.depositMethod).toBe('card');
    expect(res.body.createdAt).toEqual(expect.anything());

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

  it('checks out a Trousers garment using the T-matrix and the trousers yield formula (D-054)', async () => {
    // Trousers has no M1/M3 concept at all — its own points, its own formula.
    await prisma.measurement.updateMany({
      where: { customerId, garmentType: 'Trousers' },
      data: { isActive: false },
    });
    const lastTrousers = await prisma.measurement.findFirst({
      where: { customerId, garmentType: 'Trousers' },
      orderBy: { version: 'desc' },
    });
    await prisma.measurement.create({
      data: {
        customerId,
        garmentType: 'Trousers',
        version: (lastTrousers?.version ?? 0) + 1,
        isActive: true,
        t1Waist: 82,
        t2Hip: 98,
        t3Inseam: 78,
        t4Outseam: 105,
        t5Thigh: 58,
        t6Knee: 42,
        t7AnkleOpening: 38,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set(auth())
      .send({
        customerId,
        items: [{ garmentType: 'Trousers', fabricBatchId: batchId, unitPrice: 250 }],
      })
      .expect(201);
    createdOrderIds.push(res.body.id);

    expect(res.body.tickets[0].garmentType).toBe('Trousers');
    // (1.05 × 2) + 0.25 trousers allowance = 2.35m — no sleeve term at all
    expect(res.body.totalReservedMeters).toBe('2.35');
  });

  it('checks out a garment with no fabricBatchId when the customer supplies their own material (D-064)', async () => {
    const before = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });

    const res = await request(app.getHttpServer())
      .post('/api/v1/pos/orders')
      .set(auth())
      .send({
        customerId,
        items: [{ garmentType: 'Thobe', unitPrice: 400 }],
      })
      .expect(201);
    createdOrderIds.push(res.body.id);

    // The estimate still comes back — useful even with no store fabric involved.
    expect(res.body.totalReservedMeters).toBe('3.82');
    expect(res.body.tickets).toHaveLength(1);
    // No deposit was taken — a receipt has no "how was this paid" answer to print.
    expect(res.body.depositMethod).toBeNull();

    // Nothing touched the roll: no reservation held, no quantity moved.
    const after = await prisma.inventoryBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(after.currentQuantity.toFixed(2)).toBe(before.currentQuantity.toFixed(2));
    expect(after.reservedQuantity.toFixed(2)).toBe(before.reservedQuantity.toFixed(2));

    const reservations = await prisma.fabricReservation.findMany({
      where: { orderItem: { orderId: res.body.id } },
    });
    expect(reservations).toHaveLength(0);

    // The cutting station has nothing to consume — this must not throw.
    const ticket = await prisma.productionTicket.findFirstOrThrow({ where: { orderId: res.body.id } });
    await request(app.getHttpServer())
      .put(`/api/v1/workshop/tickets/${ticket.id}/station`)
      .set(auth())
      .send({ toStation: 'cutting' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/v1/workshop/tickets/${ticket.id}/station`)
      .set(auth())
      .send({ toStation: 'stitching' })
      .expect(200);
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

  it('settles the balance at handover without auto-closing an order that is not ready', async () => {
    const orderId = createdOrderIds[0];
    // Still 'pending' at this point — the earlier tests only moved a single
    // ticket's station, never the order's own status.
    const res = await request(app.getHttpServer())
      .post(`/api/v1/pos/orders/${orderId}/settle`)
      .set(auth())
      .send({ amount: 600, method: 'cash' })
      .expect(201);

    expect(res.body.balanceDue).toBe('0.00');
    expect(res.body.depositRealised).toBe('600.00');
    // Money is never blocked on a workflow technicality, but an order still
    // sitting in production must not be silently marked handed over (D-051).
    expect(res.body.markedDelivered).toBe(false);
    expect(res.body.status).toBe('pending');

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('pending');
    expect(order.deliveredAt).toBeNull();
  });

  it('refuses to take more than the outstanding balance', async () => {
    const orderId = createdOrderIds[0];
    await request(app.getHttpServer())
      .post(`/api/v1/pos/orders/${orderId}/settle`)
      .set(auth())
      .send({ amount: 100 })
      .expect(400);
  });

  it('exposes the order via the generic Orders API with invoice and tickets for reprint', async () => {
    const orderId = createdOrderIds[0];
    const res = await request(app.getHttpServer())
      .get(`/api/v1/orders/${orderId}`)
      .set(auth())
      .expect(200);

    expect(res.body.invoice).toEqual(
      expect.objectContaining({
        invoiceNumber: expect.any(String),
        qrCodeBase64: expect.any(String),
      }),
    );
    // Decimal fields serialize as their canonical numeric string (no forced
    // trailing zeros), unlike pos.service.ts checkout()'s response, which
    // calls .toFixed(2) explicitly — compare numerically here instead.
    expect(Number(res.body.invoice.totalAmount)).toBe(1200);
    expect(res.body.tickets).toHaveLength(3);
    expect(res.body.tickets[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        ticketCode: expect.any(String),
        station: expect.any(String),
        garmentType: 'Thobe',
      }),
    );

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const list = await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set(auth())
      .query({ search: order.orderNumber })
      .expect(200);
    expect(list.body.items.some((o: { id: string }) => o.id === orderId)).toBe(true);
  });

  it('closes the order out to delivered when the final payment lands on a ready order', async () => {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const order = await prisma.order.create({
      data: {
        organizationId: customer.organizationId,
        storeId,
        customerId,
        orderNumber: `ORD-TEST-${Date.now()}`,
        totalAmount: 200,
        paidAmount: 0,
        status: 'ready',
      },
    });
    createdOrderIds.push(order.id);
    // A real order never reaches 'ready' without an invoice already issued —
    // give this synthetic one one too, so the delivered-notification worker
    // this test triggers has a real invoice to attach the PDF to.
    await prisma.invoice.create({
      data: {
        organizationId: customer.organizationId,
        orderId: order.id,
        invoiceNumber: `INV-TEST-${Date.now()}`,
        netAmount: 173.91,
        vatAmount: 26.09,
        totalAmount: 200,
      },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/pos/orders/${order.id}/settle`)
      .set(auth())
      .send({ amount: 200, method: 'cash' })
      .expect(201);

    expect(res.body.balanceDue).toBe('0.00');
    expect(res.body.markedDelivered).toBe(true);
    expect(res.body.status).toBe('delivered');

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe('delivered');
    expect(updated.deliveredAt).not.toBeNull();

    const history = await prisma.orderStatusHistory.findFirst({
      where: { orderId: order.id, toStatus: 'delivered' },
    });
    expect(history).not.toBeNull();
    expect(history?.note).toMatch(/settlement/i);
  });
});
