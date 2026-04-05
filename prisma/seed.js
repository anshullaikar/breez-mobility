const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
  console.log('[Seed] Starting...');

  // Fare slabs
  const slabs = [
    { name: '0-10 km', minKm: 0, maxKm: 10, price: 15000 },
    { name: '10-25 km', minKm: 10, maxKm: 25, price: 30000 },
    { name: '25-50 km', minKm: 25, maxKm: 50, price: 50000 },
    { name: '50+ km', minKm: 50, maxKm: 9999, price: 80000 },
  ];

  for (const slab of slabs) {
    await prisma.fareSlab.upsert({
      where: { id: slab.name.replace(/\s/g, '-').toLowerCase() },
      update: slab,
      create: { id: slab.name.replace(/\s/g, '-').toLowerCase(), ...slab },
    });
  }
  console.log('[Seed] Fare slabs created');

  // Super admin
  await prisma.user.upsert({
    where: { phone: '+919999000001' },
    update: {},
    create: {
      phone: '+919999000001',
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      pin: '0000',
    },
  });

  // Ops admin
  await prisma.user.upsert({
    where: { phone: '+919999000002' },
    update: {},
    create: {
      phone: '+919999000002',
      name: 'Ops Admin',
      role: 'ADMIN',
      pin: '0000',
    },
  });
  console.log('[Seed] Admin users created');

  // Mumbai area coordinates for realistic simulation
  const mumbaiAreas = [
    { name: 'Andheri', lat: 19.1136, lng: 72.8697 },
    { name: 'Bandra', lat: 19.0596, lng: 72.8295 },
    { name: 'Powai', lat: 19.1176, lng: 72.9060 },
    { name: 'Dadar', lat: 19.0178, lng: 72.8478 },
    { name: 'Colaba', lat: 18.9067, lng: 72.8147 },
  ];

  // 30 drivers
  for (let i = 1; i <= 30; i++) {
    const empId = `BRZ${String(i).padStart(4, '0')}`;
    await prisma.user.upsert({
      where: { employeeId: empId },
      update: {},
      create: {
        phone: `+91900000${String(i).padStart(4, '0')}`,
        name: `Driver ${i}`,
        role: 'DRIVER',
        employeeId: empId,
        pin: '1234',
      },
    });
  }
  console.log('[Seed] 30 drivers created');

  // 20 vehicles
  const evModels = ['Tata Nexon EV', 'MG ZS EV', 'Tata Tiago EV', 'BYD e6'];
  for (let i = 1; i <= 20; i++) {
    const plate = `MH01BZ${String(i).padStart(4, '0')}`;
    await prisma.vehicle.upsert({
      where: { plateNumber: plate },
      update: {},
      create: {
        plateNumber: plate,
        model: evModels[i % evModels.length],
        year: 2024,
        batteryCapacity: 40 + (i % 3) * 10,
        parkingBay: `Bay ${i}`,
        currentSoc: 60 + Math.floor(Math.random() * 40),
      },
    });
  }
  console.log('[Seed] 20 vehicles created');

  // 100 passengers
  for (let i = 1; i <= 100; i++) {
    await prisma.user.upsert({
      where: { phone: `+91800000${String(i).padStart(4, '0')}` },
      update: {},
      create: {
        phone: `+91800000${String(i).padStart(4, '0')}`,
        name: `Passenger ${i}`,
        role: 'PASSENGER',
      },
    });
  }
  console.log('[Seed] 100 passengers created');

  console.log('[Seed] Done!');
  await prisma.$disconnect();
}

seed().catch((err) => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
