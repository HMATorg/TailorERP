/* eslint-disable no-console */
/**
 * Generates data at the scale the PRD targets (§5: 1,000+ stores, 1M+ customers;
 * HQ dashboard aggregation for 100 stores must stay under 2s).
 *
 * Creates an isolated "Scale Test Chain" organisation so it can be dropped
 * without touching the demo tenant:
 *   npm run prisma:seed-scale            # 100 stores, 500 orders each
 *   STORES=250 ORDERS=800 npm run prisma:seed-scale
 *   CLEANUP=1 npm run prisma:seed-scale  # remove it again
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ORG_NAME = 'Scale Test Chain';
const STORES = Number(process.env.STORES ?? 100);
const ORDERS_PER_STORE = Number(process.env.ORDERS ?? 500);
const CUSTOMERS = Number(process.env.CUSTOMERS ?? 2000);
const STATUSES = ['pending', 'cutting', 'sewing', 'fitting', 'ready', 'delivered'] as const;

async function cleanup(organizationId: string) {
  console.log('Removing scale-test data…');
  // Children first — FKs are RESTRICT by default on these paths
  await prisma.$executeRaw`
    DELETE FROM order_item_fabrics WHERE order_item_id IN (
      SELECT oi.id FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.organization_id = ${organizationId}::uuid)`;
  await prisma.$executeRaw`
    DELETE FROM order_status_history WHERE order_id IN (
      SELECT id FROM orders WHERE organization_id = ${organizationId}::uuid)`;
  await prisma.$executeRaw`
    DELETE FROM order_items WHERE order_id IN (
      SELECT id FROM orders WHERE organization_id = ${organizationId}::uuid)`;
  await prisma.payment.deleteMany({ where: { order: { organizationId } } });
  await prisma.invoice.deleteMany({ where: { organizationId } });
  await prisma.order.deleteMany({ where: { organizationId } });
  await prisma.customerStoreVisit.deleteMany({ where: { customer: { organizationId } } });
  await prisma.customer.deleteMany({ where: { organizationId } });
  await prisma.userStoreRole.deleteMany({ where: { store: { organizationId } } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.organizationSubscription.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.store.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
  console.log('Removed.');
}

async function main() {
  const existing = await prisma.organization.findFirst({ where: { name: ORG_NAME } });

  if (process.env.CLEANUP) {
    if (existing) await cleanup(existing.id);
    else console.log('Nothing to clean up.');
    return;
  }
  if (existing) {
    console.log('Scale-test org already exists — run with CLEANUP=1 first to regenerate.');
    return;
  }

  const started = Date.now();
  const org = await prisma.organization.create({
    data: { name: ORG_NAME, defaultCurrency: 'SAR', timezone: 'Asia/Riyadh' },
  });
  const plan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'enterprise' } });
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  await prisma.organizationSubscription.create({
    data: {
      organizationId: org.id,
      planId: plan.id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  await prisma.user.create({
    data: {
      email: 'scale-hq@tailonix.test',
      passwordHash: await bcrypt.hash('Tailonix@Dev1', 10),
      fullName: 'Scale HQ Admin',
      organizationId: org.id,
      orgRole: 'hq_admin',
    },
  });

  console.log(`Creating ${STORES} stores…`);
  await prisma.store.createMany({
    data: Array.from({ length: STORES }, (_, i) => ({
      organizationId: org.id,
      name: `Scale Store ${String(i + 1).padStart(3, '0')}`,
      isHeadquarters: i === 0,
      operatingHours: { sun: { open: '09:00', close: '21:00' } } as Prisma.InputJsonValue,
    })),
  });
  const stores = await prisma.store.findMany({
    where: { organizationId: org.id },
    select: { id: true },
  });

  console.log(`Creating ${CUSTOMERS} customers…`);
  await prisma.customer.createMany({
    data: Array.from({ length: CUSTOMERS }, (_, i) => ({
      organizationId: org.id,
      fullName: `Scale Customer ${i + 1}`,
      phone: `+9665${String(10_000_000 + i).slice(0, 8)}`,
      whatsappConsent: i % 3 === 0,
    })),
  });
  const customers = await prisma.customer.findMany({
    where: { organizationId: org.id },
    select: { id: true },
  });

  const total = STORES * ORDERS_PER_STORE;
  console.log(`Creating ${total.toLocaleString()} orders…`);
  const DAY = 24 * 3600 * 1000;

  for (const [index, store] of stores.entries()) {
    const rows = Array.from({ length: ORDERS_PER_STORE }, (_, j) => {
      // Spread across the last 90 days so date-range filters are meaningful
      const createdAt = new Date(Date.now() - Math.floor(Math.random() * 90) * DAY);
      const amount = 150 + Math.floor(Math.random() * 850);
      return {
        organizationId: org.id,
        storeId: store.id,
        customerId: customers[Math.floor(Math.random() * customers.length)].id,
        orderNumber: `ORD-${String(j + 1).padStart(6, '0')}`,
        status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
        totalAmount: new Prisma.Decimal(amount),
        paidAmount: new Prisma.Decimal(Math.random() > 0.4 ? amount : 0),
        createdAt,
        updatedAt: createdAt,
      };
    });
    await prisma.order.createMany({ data: rows, skipDuplicates: true });
    if ((index + 1) % 20 === 0) {
      console.log(`  …${index + 1}/${STORES} stores populated`);
    }
  }

  const orderCount = await prisma.order.count({ where: { organizationId: org.id } });
  console.log(
    `Done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${STORES} stores, ${orderCount.toLocaleString()} orders, ${CUSTOMERS} customers`,
  );
  console.log('HQ login: scale-hq@tailonix.test / Tailonix@Dev1');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
