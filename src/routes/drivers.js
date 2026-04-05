const { Router } = require('express');
const prisma = require('../config/database');
const { redis } = require('../config/redis');
const { auth, requireRole } = require('../middleware/auth');
const { publish } = require('../sse/manager');

const router = Router();

// GET /drivers/shift-state - the brain of the driver app
// Returns what state the driver is in so the UI knows exactly what to show
router.get('/shift-state', auth, requireRole('DRIVER'), async (req, res) => {
  try {
    const driverId = req.user.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const vehicle = await prisma.vehicle.findFirst({
      where: { currentDriverId: driverId },
      select: { id: true, plateNumber: true, model: true, currentSoc: true, parkingBay: true, status: true },
    });

    const todaysLogs = vehicle ? await prisma.batteryLog.findMany({
      where: { driverId, vehicleId: vehicle.id, createdAt: { gte: today } },
      orderBy: { createdAt: 'asc' },
    }) : [];

    const logTypes = todaysLogs.map(l => l.eventType);

    const activeRide = await prisma.ride.findFirst({
      where: { driverId, status: { in: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        slab: true,
        vehicle: { select: { id: true, plateNumber: true, model: true } },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    const lastCompletedRide = await prisma.ride.findFirst({
      where: { driverId, status: 'COMPLETED', completedAt: { gte: today } },
      orderBy: { completedAt: 'desc' },
    });

    const online = await redis.get(`driver:${driverId}:online`);

    // Determine shift state
    let state, nextAction, prompt;

    if (!vehicle) {
      state = 'NO_VEHICLE';
      nextAction = null;
      prompt = 'No vehicle assigned. Contact admin.';
    } else if (!logTypes.includes('VEHICLE_PICKUP')) {
      state = 'NEEDS_PICKUP_LOG';
      nextAction = 'VEHICLE_PICKUP';
      prompt = `Log battery for ${vehicle.plateNumber} to start your shift`;
    } else if (logTypes.includes('CHARGE_START') && !logTypes.includes('CHARGE_END')) {
      state = 'CHARGING';
      nextAction = 'CHARGE_END';
      prompt = 'Enter SOC when charging is complete';
    } else if (activeRide) {
      state = 'ON_RIDE';
      nextAction = null;
      prompt = null;
    } else if (lastCompletedRide) {
      const lastDropLog = todaysLogs.filter(l => l.eventType === 'VEHICLE_DROP').pop();
      const needsPostRide = !lastDropLog || lastCompletedRide.completedAt > lastDropLog.createdAt;
      if (needsPostRide) {
        state = 'NEEDS_POSTRIDE_LOG';
        nextAction = 'VEHICLE_DROP';
        prompt = 'Log post-ride battery to continue';
      } else {
        state = online === '1' ? 'ONLINE' : 'OFFLINE';
      }
    } else {
      state = online === '1' ? 'ONLINE' : 'OFFLINE';
    }

    const pendingAssignments = await prisma.ride.count({
      where: { driverId, status: 'ASSIGNED' },
    });

    const todayCompletedCount = await prisma.ride.count({
      where: { driverId, status: 'COMPLETED', completedAt: { gte: today } },
    });

    res.json({
      state,
      nextAction,
      prompt,
      vehicle,
      activeRide,
      online: online === '1',
      todaysLogs,
      pendingAssignments,
      todayCompletedCount,
    });
  } catch (err) {
    console.error('[Driver:shiftState]', err);
    res.status(500).json({ error: 'Failed to get shift state' });
  }
});

// POST /drivers/battery-log - submit SOC (event type auto-detected from shift state)
router.post('/battery-log', auth, requireRole('DRIVER'), async (req, res) => {
  try {
    const { soc, range, notes } = req.body;
    if (soc === undefined) return res.status(400).json({ error: 'soc required' });

    const driverId = req.user.id;
    const vehicle = await prisma.vehicle.findFirst({ where: { currentDriverId: driverId } });
    if (!vehicle) return res.status(400).json({ error: 'No vehicle assigned' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaysLogs = await prisma.batteryLog.findMany({
      where: { driverId, vehicleId: vehicle.id, createdAt: { gte: today } },
      orderBy: { createdAt: 'asc' },
    });
    const logTypes = todaysLogs.map(l => l.eventType);

    // Auto-detect event type from current state
    let eventType;
    if (!logTypes.includes('VEHICLE_PICKUP')) {
      eventType = 'VEHICLE_PICKUP';
    } else {
      eventType = 'VEHICLE_DROP';
    }

    const log = await prisma.batteryLog.create({
      data: {
        driverId, vehicleId: vehicle.id, eventType,
        soc: Number(soc),
        range: range ? Number(range) : Math.floor(Number(soc) * 3.5),
        notes: notes || null,
      },
    });

    await prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { currentSoc: Number(soc) },
    });

    if (soc < 20) {
      await publish('fleet', 'low_battery_alert', { vehicleId: vehicle.id, driverId, soc: Number(soc), eventType });
    }

    await publish('fleet', 'battery_log', { vehicleId: vehicle.id, driverId, eventType, soc: Number(soc) });
    res.status(201).json({ ...log, autoDetectedType: eventType });
  } catch (err) {
    console.error('[Driver:batteryLog]', err);
    res.status(500).json({ error: 'Failed to submit battery log' });
  }
});

// POST /drivers/online - gated: must have VEHICLE_PICKUP log
router.post('/online', auth, requireRole('DRIVER'), async (req, res) => {
  const driverId = req.user.id;
  const vehicle = await prisma.vehicle.findFirst({ where: { currentDriverId: driverId } });
  if (!vehicle) return res.status(400).json({ error: 'No vehicle assigned' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pickupLog = await prisma.batteryLog.findFirst({
    where: { driverId, vehicleId: vehicle.id, eventType: 'VEHICLE_PICKUP', createdAt: { gte: today } },
  });
  if (!pickupLog) return res.status(400).json({ error: 'Must log vehicle pickup battery before going online' });

  await redis.setex(`driver:${driverId}:online`, 60, '1');
  await prisma.vehicle.update({ where: { id: vehicle.id }, data: { status: 'AVAILABLE' } });
  await publish('fleet', 'driver_online', { driverId });
  res.json({ status: 'online' });
});

// POST /drivers/offline
router.post('/offline', auth, requireRole('DRIVER'), async (req, res) => {
  const driverId = req.user.id;
  await redis.del(`driver:${driverId}:online`);
  const vehicle = await prisma.vehicle.findFirst({ where: { currentDriverId: driverId } });
  if (vehicle) {
    await prisma.vehicle.update({ where: { id: vehicle.id }, data: { status: 'OFFLINE' } });
    // Don't delete vehicle location — keep last known position
  }
  await publish('fleet', 'driver_offline', { driverId, vehicleId: vehicle?.id });
  res.json({ status: 'offline' });
});

// POST /drivers/start-charging
router.post('/start-charging', auth, requireRole('DRIVER'), async (req, res) => {
  const { soc, chargerStation } = req.body;
  if (soc === undefined) return res.status(400).json({ error: 'soc required' });
  const driverId = req.user.id;
  const vehicle = await prisma.vehicle.findFirst({ where: { currentDriverId: driverId } });
  if (!vehicle) return res.status(400).json({ error: 'No vehicle assigned' });

  const activeRide = await prisma.ride.findFirst({
    where: { driverId, status: { in: ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
  });
  if (activeRide) return res.status(400).json({ error: 'Cannot charge while on a ride' });

  const log = await prisma.batteryLog.create({
    data: { driverId, vehicleId: vehicle.id, eventType: 'CHARGE_START', soc: Number(soc), notes: chargerStation || null },
  });
  await prisma.vehicle.update({ where: { id: vehicle.id }, data: { currentSoc: Number(soc), status: 'CHARGING' } });
  await redis.del(`driver:${driverId}:online`);
  await publish('fleet', 'battery_log', { vehicleId: vehicle.id, driverId, eventType: 'CHARGE_START', soc: Number(soc) });
  res.status(201).json(log);
});

// POST /drivers/end-charging
router.post('/end-charging', auth, requireRole('DRIVER'), async (req, res) => {
  const { soc } = req.body;
  if (soc === undefined) return res.status(400).json({ error: 'soc required' });
  const driverId = req.user.id;
  const vehicle = await prisma.vehicle.findFirst({ where: { currentDriverId: driverId } });
  if (!vehicle) return res.status(400).json({ error: 'No vehicle assigned' });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const chargeStart = await prisma.batteryLog.findFirst({
    where: { driverId, vehicleId: vehicle.id, eventType: 'CHARGE_START', createdAt: { gte: today } },
    orderBy: { createdAt: 'desc' },
  });
  const durationMinutes = chargeStart ? Math.round((Date.now() - chargeStart.createdAt.getTime()) / 60000) : null;

  const log = await prisma.batteryLog.create({
    data: {
      driverId, vehicleId: vehicle.id, eventType: 'CHARGE_END', soc: Number(soc),
      range: Math.floor(Number(soc) * 3.5),
      notes: durationMinutes ? `Charged for ${durationMinutes} min` : null,
    },
  });
  await prisma.vehicle.update({ where: { id: vehicle.id }, data: { currentSoc: Number(soc), status: 'AVAILABLE' } });
  await publish('fleet', 'battery_log', { vehicleId: vehicle.id, driverId, eventType: 'CHARGE_END', soc: Number(soc) });
  res.status(201).json({ ...log, durationMinutes });
});

// POST /drivers/location - GPS ping, stored against vehicle
router.post('/location', auth, requireRole('DRIVER'), async (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  const driverId = req.user.id;

  // Find driver's assigned vehicle
  const vehicle = await prisma.vehicle.findFirst({ where: { currentDriverId: driverId }, select: { id: true } });

  // Store location against VEHICLE (not driver) - the location belongs to the vehicle
  if (vehicle) {
    await redis.hset(`vehicle:${vehicle.id}:loc`, { lat, lng, ts: Date.now(), driverId });
    await redis.expire(`vehicle:${vehicle.id}:loc`, 120); // stale after 2 min
    await redis.geoadd('vehicles:active', lng, lat, vehicle.id);
  }

  // Keep driver online status
  await redis.setex(`driver:${driverId}:online`, 60, '1');

  // Publish to fleet channel with both vehicle and driver IDs
  await publish('fleet', 'vehicle_location', {
    vehicleId: vehicle?.id, driverId, lat, lng, ts: Date.now(),
  });

  // If driver is on an active ride, publish to ride channel for passenger tracking
  const activeRide = await prisma.ride.findFirst({
    where: { driverId, status: { in: ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
    select: { id: true },
  });
  if (activeRide) {
    await publish(`ride:${activeRide.id}`, 'driver_location', { lat, lng, ts: Date.now() });
  }
  res.json({ ok: true });
});

// GET /drivers/assignments
router.get('/assignments', auth, requireRole('DRIVER'), async (req, res) => {
  const rides = await prisma.ride.findMany({
    where: { driverId: req.user.id, status: { in: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
    include: {
      passenger: { select: { id: true, name: true, phone: true } },
      slab: true,
      vehicle: { select: { id: true, plateNumber: true, model: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });
  res.json(rides);
});

// GET /drivers/nearby
router.get('/nearby', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { lat, lng, radius = 5 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  const nearby = await redis.geosearch('drivers:active', 'FROMLONLAT', Number(lng), Number(lat), 'BYRADIUS', Number(radius), 'km', 'ASC', 'COUNT', 20, 'WITHDIST');
  res.json(nearby);
});

module.exports = router;