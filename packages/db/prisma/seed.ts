import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from '../src/client.js';

const prisma = new PrismaClient({
  datasources: { db: { url: resolveDatabaseUrl() } },
});

async function main(): Promise<void> {
  console.info('Seeding dev database...');

  // ── UoM ──────────────────────────────────────────────────────────────
  await prisma.unitOfMeasure.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      uomCode: 'EA',
      uomName: 'Each',
      uomCategory: 'COUNT',
      decimalScale: 0,
    },
    update: {},
  });
  console.info('  ✓ UoM: EA');

  // ── Admin user ────────────────────────────────────────────────────────
  const adminUser = await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0001-000000000001' },
    create: {
      id: '00000000-0000-0000-0001-000000000001',
      cognitoSubject: 'dev-admin-subject',
      email: 'admin@golfingarage.local',
      displayName: 'Dev Admin',
      status: 'ACTIVE',
    },
    update: {},
  });
  console.info('  ✓ User: admin@golfingarage.local');

  // ── Admin role ────────────────────────────────────────────────────────
  const adminRole = await prisma.role.upsert({
    where: { id: '00000000-0000-0000-0002-000000000001' },
    create: {
      id: '00000000-0000-0000-0002-000000000001',
      roleCode: 'admin',
      roleName: 'Administrator',
      description: 'Full system access',
      isSystem: true,
    },
    update: {},
  });
  await prisma.userRole.upsert({
    where: { id: '00000000-0000-0000-0003-000000000001' },
    create: {
      id: '00000000-0000-0000-0003-000000000001',
      userId: adminUser.id,
      roleId: adminRole.id,
      assignmentStatus: 'ACTIVE',
      correlationId: 'seed',
    },
    update: {},
  });
  console.info('  ✓ Role: admin → dev admin user');

  // ── Admin employee record ────────────────────────────────────────────
  await prisma.employee.upsert({
    where: { id: '00000000-0000-0000-0004-000000000001' },
    create: {
      id: '00000000-0000-0000-0004-000000000001',
      userId: adminUser.id,
      employeeNumber: 'EMP-001',
      firstName: 'Dev',
      lastName: 'Admin',
      employmentState: 'ACTIVE',
      hireDate: new Date('2024-01-01'),
    },
    update: {},
  });

  // ── Sample technician ─────────────────────────────────────────────────
  const techUser = await prisma.user.upsert({
    where: { id: '00000000-0000-0000-0001-000000000002' },
    create: {
      id: '00000000-0000-0000-0001-000000000002',
      cognitoSubject: 'dev-tech-subject',
      email: 'tech@golfingarage.local',
      displayName: 'Sample Tech',
      status: 'ACTIVE',
    },
    update: {},
  });
  await prisma.employee.upsert({
    where: { id: '00000000-0000-0000-0004-000000000002' },
    create: {
      id: '00000000-0000-0000-0004-000000000002',
      userId: techUser.id,
      employeeNumber: 'EMP-002',
      firstName: 'Sample',
      lastName: 'Tech',
      employmentState: 'ACTIVE',
      hireDate: new Date('2024-03-01'),
    },
    update: {},
  });
  console.info('  ✓ Employees: EMP-001, EMP-002');

  // ── Stock location ────────────────────────────────────────────────────
  const mainShop = await prisma.stockLocation.upsert({
    where: { id: '00000000-0000-0000-0005-000000000001' },
    create: {
      id: '00000000-0000-0000-0005-000000000001',
      locationCode: 'MAIN',
      locationName: 'Main Shop',
      locationType: 'WAREHOUSE',
      isPickable: true,
      timezoneName: 'America/New_York',
    },
    update: {},
  });
  await prisma.stockLocation.upsert({
    where: { id: '00000000-0000-0000-0005-000000000002' },
    create: {
      id: '00000000-0000-0000-0005-000000000002',
      locationCode: 'BAY-1',
      locationName: 'Bay 1',
      locationType: 'BAY',
      parentLocationId: mainShop.id,
      isPickable: true,
      timezoneName: 'America/New_York',
    },
    update: {},
  });
  await prisma.stockLocation.upsert({
    where: { id: '00000000-0000-0000-0005-000000000003' },
    create: {
      id: '00000000-0000-0000-0005-000000000003',
      locationCode: 'BAY-2',
      locationName: 'Bay 2',
      locationType: 'BAY',
      parentLocationId: mainShop.id,
      isPickable: true,
      timezoneName: 'America/New_York',
    },
    update: {},
  });
  console.info('  ✓ Locations: MAIN, BAY-1, BAY-2');

  // ── Sample parts (golf cart) ──────────────────────────────────────────
  const partsData = [
    { sku: 'BATT-48V-105AH', name: '48V 105Ah Lithium Battery Pack' },
    { sku: 'MOTOR-AC-5HP', name: 'AC 5HP Golf Cart Motor' },
    { sku: 'CTRL-SEVCON-48V', name: 'Sevcon 48V Motor Controller' },
    { sku: 'TIRE-18X8-8', name: '18x8-8 Turf Tire' },
    { sku: 'RIM-8IN-CHROME', name: '8" Chrome Wheel Rim' },
    { sku: 'CHARGER-48V-15A', name: '48V 15A Onboard Charger' },
    { sku: 'LIFT-KIT-4IN', name: '4" Lift Kit - Club Car DS' },
    { sku: 'SEAT-REAR-FLIP', name: 'Rear Flip Seat Kit' },
    { sku: 'LIGHT-LED-KIT', name: 'LED Street Light Kit' },
    { sku: 'WINDSHIELD-FOLD', name: 'Fold-Down Windshield' },
  ];

  for (const p of partsData) {
    await prisma.part.upsert({
      where: { id: `00000000-0000-0000-0006-${partsData.indexOf(p).toString().padStart(12, '0')}` },
      create: {
        id: `00000000-0000-0000-0006-${partsData.indexOf(p).toString().padStart(12, '0')}`,
        sku: p.sku,
        name: p.name,
        unitOfMeasure: 'EA',
        partState: 'ACTIVE',
        reorderPoint: 2,
      },
      update: {},
    });
  }
  console.info(`  ✓ Parts: ${partsData.length} golf cart parts`);

  // ── Sample vendor ─────────────────────────────────────────────────────
  await prisma.vendor.upsert({
    where: { id: '00000000-0000-0000-0007-000000000001' },
    create: {
      id: '00000000-0000-0000-0007-000000000001',
      vendorCode: 'MADJAX',
      vendorName: 'MadJax Golf Cart Parts',
      vendorState: 'ACTIVE',
      email: 'orders@madjax.com',
      leadTimeDays: 5,
      paymentTerms: 'NET30',
    },
    update: {},
  });
  console.info('  ✓ Vendor: MADJAX');

  // ── Sample work order ─────────────────────────────────────────────────
  await prisma.woOrder.upsert({
    where: { workOrderNumber: 'WO-2024-0001' },
    create: {
      id: '00000000-0000-0000-0008-000000000001',
      workOrderNumber: 'WO-2024-0001',
      title: 'Club Car DS Full Build - Lifted Lifted Off-Road',
      customerReference: 'CUST-DEMO-001',
      assetReference: 'CART-001-2019-CC-DS',
      status: 'READY',
      priority: 2,
      stockLocationId: mainShop.id,
      createdByUserId: adminUser.id,
      correlationId: 'seed',
    },
    update: {},
  });
  console.info('  ✓ Work order: WO-2024-0001');

  console.info('\nSeed complete ✓');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
