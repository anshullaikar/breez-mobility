const { Router } = require('express');
const prisma = require('../config/database');
const { redis } = require('../config/redis');
const { auth, requireRole } = require('../middleware/auth');
const { validateNextBatteryEvent } = require('../services/stateMachine');
const { publish } = require('../sse/manager');

const router = Router();

// POST /drivers/online - go online (start shift)
router.post('/online', auth, requireRole('DRIVER'), async (req, res) => {
  await redis.setex(`driver:${req.user.id}:online`, 60, '1');
  await publish('fleet', 'driver_online', { driverId: req.user.id });
  res.json({ status: 'online' });
});

// POST /drivers/offline - go offline
router.post('/offline', auth, requireRole('DRIVER'), async (req, res) => {
  await redis.del(`driver:${req.user.id}:online`);
  await redis.del(`driver:${req.user.id}:loc`);
  await publish('fleet', 'driver_offline', { driverId: req.user.id });
  res.json({ status: 'offline' });
});

// POST /drivers/location - GPS ping (called every 3-5s)
router.post('/location', auth, requireRole('DRIVER'), async (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const driverId = req.user.id;

  // Store in Redis hash with TTL (stale after 60s = effectively offline)
  await redis.hset(`driver:${driverId}:loc`, { lat, lng, ts: Date.now() });
  await redis.expire(`driver:${driverId}:loc`, 60);

  // Refresh online status
  await redis.setex(`driver:${driverId}:online`, 60, '1');

  // Store in Redis GEO set for spatial queries
  await redis.geoadd('drivers:active', lng, lat, driverId);

  // Publish to fleet channel for admin live map
  await publish('fleet', 'driver_location', { driverId, lat, lng, ts: Date.now() });

  // If driver is on an active ride, publish to ride channel too
  const activeRide = await prisma.ride.findFirst({
    where: { driverId, status: { in: ['EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] } },
    select: { id: true },
  });
  if (activeRide) {
    await publish(`ride:${activeRide.id}`, 'driver_location', { lat, lng, ts: Date.now() });
  }

  res.json({ ok: true });
});

// GET /drivers/assignments - upcoming ride assignments
router.get('/assignments', auth, requireRole('DRIVER'), async (req, res) => {
  const rides = await prisma.ride.findMany({
    where: {
      driverId: req.user.id,
      status: { in: ['ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS'] },
    },
    include: {
      passenger: { select: { id: true, name: true, phone: true } },
      slab: true,
      vehicle: { select: { id: true, plateNumber: true, model: true } },
    },
    orderBy: { scheduledAt: 'asc' },
  });
  res.json(rides);
});

// POST /drivers/battery-log - submit battery log entry
router.post('/battery-log', auth, requireRole('DRIVER'), async (req, res) => {
  try {
    const { vehicleId, eventType, soc, range, notes } = req.body;
    if (!vehicleId || !eventType || soc === undefined) {
      return res.status(400).json({ error: 'vehicleId, eventType, and soc required' });
    }

    // Get today's logs for this driver+vehicle to validate sequence
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaysLogs = await prisma.batteryLog.findMany({
      where: {
        driverId: req.user.id,
        vehicleId,
        createdAt: { gte: today },
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!validateNextBatteryEvent(todaysLogs, eventType)) {
      const nextExpected = require('../services/stateMachine').BATTERY_SEQUENCE[todaysLogs.length];
      return res.status(400).json({
        error: `Invalid battery event sequence. Expected: ${nextExpected || 'shift complete'}`,
        currentLogs: todaysLogs.map(l => l.eventType),
      });
    }

    const log = await prisma.batteryLog.create({
      data: { driverId: req.user.id, vehicleId, eventType, soc, range, notes },
    });

    // Update vehicle SOC
    await prisma.vehicle.update({
      where: { id: vehicleId },
      data: { currentSoc: soc },
    });

    // Alert if SOC below 20%
    if (soc < 20) {
      await publish('fleet', 'low_battery_alert', {
        vehicleId,
        driverId: req.user.id,
        soc,
        eventType,
      });
    }

    await publish('fleet', 'battery_log', {
      vehicleId,
      driverId: req.user.id,
      eventType,
      soc,
    });

    res.status(201).json(log);
  } catch (err) {
    console.error('[Driver:batteryLog]', err);
    res.status(500).json({ error: 'Failed to submit battery log' });
  }
});

// GET /drivers/nearby?lat=&lng=&radius= - find nearby drivers (admin use)
router.get('/nearby', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const { lat, lng, radius = 5 } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

  const nearby = await redis.geosearch(
    'drivers:active',
    'FROMLONLAT', Number(lng), Number(lat),
    'BYRADIUS', Number(radius), 'km',
    'ASC', 'COUNT', 20, 'WITHDIST'
  );

  res.json(nearby);
});

module.exports = router;
