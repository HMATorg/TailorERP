/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Tailonix@Dev1', 10);

  // ── Subscription plans (PRD Appendix C) ──
  const plans = [
    {
      code: 'basic',
      name: 'Basic',
      maxStores: 1,
      maxUsers: 10,
      monthlyPrice: 199,
      yearlyPrice: 1990,
      features: ['orders', 'inventory_basic', 'appointments'],
    },
    {
      code: 'pro',
      name: 'Pro',
      maxStores: 5,
      maxUsers: 50,
      monthlyPrice: 499,
      yearlyPrice: 4990,
      features: ['orders', 'inventory_batches', 'appointments', 'pwa', 'whatsapp'],
    },
    {
      code: 'enterprise',
      name: 'Enterprise',
      maxStores: 1000,
      maxUsers: 10000,
      monthlyPrice: 1499,
      yearlyPrice: 14990,
      features: [
        'orders',
        'inventory_batches',
        'appointments',
        'pwa',
        'whatsapp',
        'multi_store',
        'regional_managers',
        'transfers',
        'reorder_alerts',
      ],
    },
  ];
  for (const p of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { code: p.code },
      update: { features: p.features, maxStores: p.maxStores, maxUsers: p.maxUsers },
      create: p,
    });
  }
  console.log('Seeded subscription plans');

  // ── Platform super admin ──
  const platformUser = await prisma.user.upsert({
    where: { email: 'admin@tailonix.com' },
    update: {},
    create: {
      email: 'admin@tailonix.com',
      passwordHash,
      fullName: 'Tailonix Super Admin',
    },
  });
  await prisma.platformAdmin.upsert({
    where: { userId: platformUser.id },
    update: {},
    create: { userId: platformUser.id, adminLevel: 'super_admin' },
  });
  console.log('Seeded platform super admin (admin@tailonix.com / Tailonix@Dev1)');

  // ── Demo tenant ──
  const existingOrg = await prisma.organization.findFirst({
    where: { name: 'Al Anwar Tailors' },
  });
  if (existingOrg) {
    console.log('Demo tenant already exists — skipping');
    return;
  }

  const org = await prisma.organization.create({
    data: { name: 'Al Anwar Tailors', defaultCurrency: 'SAR', timezone: 'Asia/Riyadh' },
  });

  const enterprisePlan = await prisma.subscriptionPlan.findUniqueOrThrow({
    where: { code: 'enterprise' },
  });
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);
  await prisma.organizationSubscription.create({
    data: {
      organizationId: org.id,
      planId: enterprisePlan.id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  const defaultHours = {
    sun: { open: '09:00', close: '21:00' },
    mon: { open: '09:00', close: '21:00' },
    tue: { open: '09:00', close: '21:00' },
    wed: { open: '09:00', close: '21:00' },
    thu: { open: '09:00', close: '21:00' },
    sat: { open: '10:00', close: '22:00' },
  };
  const hqStore = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Riyadh — Olaya (HQ)',
      isHeadquarters: true,
      phone: '+966500000001',
      operatingHours: defaultHours,
    },
  });
  const branch = await prisma.store.create({
    data: {
      organizationId: org.id,
      name: 'Jeddah — Corniche',
      phone: '+966500000002',
      operatingHours: defaultHours,
    },
  });

  const hqAdmin = await prisma.user.create({
    data: {
      email: 'owner@alanwar.example',
      passwordHash,
      fullName: 'Khalid Al Anwar',
      organizationId: org.id,
      orgRole: 'hq_admin',
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: 'manager.jeddah@alanwar.example',
      passwordHash,
      fullName: 'Fatimah Noor',
      organizationId: org.id,
    },
  });
  const tailor = await prisma.user.create({
    data: {
      email: 'tailor.jeddah@alanwar.example',
      passwordHash,
      fullName: 'Imran Siddiqui',
      organizationId: org.id,
    },
  });
  await prisma.userStoreRole.createMany({
    data: [
      { userId: manager.id, storeId: branch.id, role: 'store_manager' },
      { userId: tailor.id, storeId: branch.id, role: 'tailor' },
    ],
  });

  const supplier = await prisma.supplier.create({
    data: {
      organizationId: org.id,
      name: 'Gulf Textiles Trading LLC',
      contactPerson: 'Ahmed Hassan',
      phone: '+971501234567',
      paymentTerms: 'Net 30',
    },
  });

  await prisma.inventoryBatch.createMany({
    data: [
      {
        storeId: branch.id,
        supplierId: supplier.id,
        fabricName: 'Premium White Cotton',
        fabricCode: 'CTN-WHT',
        batchCode: 'B-2026-001',
        color: 'White',
        initialQuantity: 120,
        currentQuantity: 84.5,
        costPricePerUnit: 18.5,
        sellingPricePerUnit: 35,
        purchaseDate: new Date('2026-06-01'),
        storageLocation: 'Rack A1',
      },
      {
        storeId: branch.id,
        supplierId: supplier.id,
        fabricName: 'Premium White Cotton',
        fabricCode: 'CTN-WHT',
        batchCode: 'B-2026-014',
        color: 'White',
        initialQuantity: 200,
        currentQuantity: 200,
        costPricePerUnit: 19.25,
        sellingPricePerUnit: 35,
        purchaseDate: new Date('2026-07-10'),
        storageLocation: 'Rack A2',
      },
      {
        storeId: hqStore.id,
        supplierId: supplier.id,
        fabricName: 'Navy Wool Blend',
        fabricCode: 'WOL-NVY',
        batchCode: 'B-2026-009',
        color: 'Navy',
        initialQuantity: 80,
        currentQuantity: 12,
        costPricePerUnit: 42,
        sellingPricePerUnit: 85,
        purchaseDate: new Date('2026-05-20'),
        storageLocation: 'Rack C3',
      },
    ],
  });

  await prisma.inventoryReorderSetting.createMany({
    data: [
      { storeId: hqStore.id, fabricName: 'Navy Wool Blend', minThreshold: 20, maxThreshold: 100 },
      { storeId: branch.id, fabricName: 'Premium White Cotton', minThreshold: 50, maxThreshold: 300 },
    ],
  });

  await prisma.customer.create({
    data: {
      organizationId: org.id,
      fullName: 'Saquib Imtiaz',
      phone: '+966512345678',
      whatsappConsent: true,
      whatsappPhone: '+966512345678',
      preferredStoreId: branch.id,
      language: 'en',
    },
  });

  console.log('Seeded demo tenant: Al Anwar Tailors (2 stores, 4 staff, 1 customer)');
  console.log('Logins — HQ admin: owner@alanwar.example, manager: manager.jeddah@alanwar.example (password: Tailonix@Dev1)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
