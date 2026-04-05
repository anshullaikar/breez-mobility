const { Router } = require('express');
const prisma = require('../config/database');
const { redis } = require('../config/redis');
const { auth, requireRole } = require('../middleware/auth');
const { publish } = require('../sse/manager');

const router = Router();

// POST /admin/assign - assign driver to a ride
router.post('/assign', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { rideId, driverId, vehicleId } = req.body;

    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (ride.status !== 'BOOKED') return res.status(400).json({ error: 'Ride must be in BOOKED state' });

    // Conflict detection: check driver isn't already assigned to overlapping ride
    const conflictWindow = 2 * 60 * 60 * 1000; // 2 hours
    const conflicts = await prisma.ride.findMany({
      where: {
        driverId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        scheduledAt: {
          gte: new Date(ride.scheduledAt.getTime() - conflictWindow),
          lte: new Date(ride.scheduledAt.getTime() + conflictWindow),
        },
      },
    });

    if (conflicts.length > 0) {
      return res.status(409).json({
        error: 'Driver has conflicting ride(s)',
        conflicts: conflicts.map(c => ({ id: c.id, scheduledAt: c.scheduledAt, status: c.status })),
      });
    }

    // Optimistic concurrency
    const updated = await prisma.ride.updateMany({
      where: { id: rideId, status: 'BOOKED', version: ride.version },
      data: {
        driverId,
        vehicleId,
        status: 'ASSIGNED',
        version: ride.version + 1,
      },
    });

    if (updated.count === 0) {
      return res.status(409).json({ error: 'Concurrent modification - retry' });
    }

    await prisma.rideEvent.create({
      data: {
        rideId,
        fromState: 'BOOKED',
        toState: 'ASSIGNED',
        actor: req.user.id,
        metadata: { driverId, vehicleId },
      },
    });

    const result = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { passenger: { select: { id: true, name: true, phone: true } }, driver: { select: { id: true, name: true } }, vehicle: true },
    });

    // Notify driver and passenger
    await Promise.all([
      publish(`driver:${driverId}`, 'ride_assigned', {
        rideId,
        passenger: result.passenger,
        pickupAddress: result.pickupAddress,
        scheduledAt: result.scheduledAt,
      }),
      publish(`ride:${rideId}`, 'driver_assigned', {
        rideId,
        driver: result.driver,
        vehicle: result.vehicle,
      }),
      publish('fleet', 'ride_assigned', { rideId, driverId, vehicleId }),
    ]);

    res.json(result);
  } catch (err) {
    console.error('[Admin:assign]', err);
    res.status(500).json({ error: 'Failed to assign driver' });
  }
});

// GET /admin/fleet - all vehicles with status and SOC
router.get('/fleet', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      include: {
        currentDriver: { select: { id: true, name: true, employeeId: true } },
      },
      orderBy: { plateNumber: 'asc' },
    });

    // Enrich with live location from Redis
    const enriched = await Promise.all(vehicles.map(async (v) => {
      let location = null;
      if (v.currentDriverId) {
        const loc = await redis.hgetall(`driver:${v.currentDriverId}:loc`);
        if (loc && loc.lat) location = { lat: Number(loc.lat), lng: Number(loc.lng), ts: Number(loc.ts) };
      }
      return { ...v, location };
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[Admin:fleet]', err);
    res.status(500).json({ error: 'Failed to get fleet' });
  }
});

// GET /admin/queue - unassigned rides sorted by pickup time
router.get('/queue', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const rides = await prisma.ride.findMany({
      where: { status: 'BOOKED' },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        slab: true,
      },
      orderBy: { scheduledAt: 'asc' },
    });
    res.json(rides);
  } catch (err) {
    console.error('[Admin:queue]', err);
    res.status(500).json({ error: 'Failed to get queue' });
  }
});

// CRUD: drivers
router.post('/drivers', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { name, phone, employeeId, pin } = req.body;
    const driver = await prisma.user.create({
      data: { name, phone, employeeId, pin: pin || '1234', role: 'DRIVER' },
    });
    res.status(201).json(driver);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Duplicate phone or employee ID' });
    console.error('[Admin:createDriver]', err);
    res.status(500).json({ error: 'Failed to create driver' });
  }
});

router.get('/drivers', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  const drivers = await prisma.user.findMany({
    where: { role: 'DRIVER' },
    include: { assignedVehicle: { select: { id: true, plateNumber: true, model: true, currentSoc: true } } },
    orderBy: { name: 'asc' },
  });

  // Enrich with online status from Redis
  const enriched = await Promise.all(drivers.map(async (d) => {
    const online = await redis.get(`driver:${d.id}:online`);
    return { ...d, online: online === '1' };
  }));

  res.json(enriched);
});

// CRUD: vehicles
router.post('/vehicles', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { plateNumber, model, year, batteryCapacity, parkingBay } = req.body;
    const vehicle = await prisma.vehicle.create({
      data: { plateNumber, model, year, batteryCapacity, parkingBay, currentSoc: 100 },
    });
    res.status(201).json(vehicle);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Duplicate plate number' });
    console.error('[Admin:createVehicle]', err);
    res.status(500).json({ error: 'Failed to create vehicle' });
  }
});

// CRUD: fare slabs (super admin only)
router.get('/slabs', auth, async (req, res) => {
  const slabs = await prisma.fareSlab.findMany({ orderBy: { minKm: 'asc' } });
  res.json(slabs);
});

router.post('/slabs', auth, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { name, minKm, maxKm, price } = req.body;
    if (!name || minKm === undefined || maxKm === undefined || price === undefined) {
      return res.status(400).json({ error: 'name, minKm, maxKm, price required' });
    }
    const slab = await prisma.fareSlab.create({ data: { name, minKm, maxKm, price } });
    res.status(201).json(slab);
  } catch (err) {
    console.error('[Admin:createSlab]', err);
    res.status(500).json({ error: 'Failed to create slab' });
  }
});

router.put('/slabs/:id', auth, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    const { price, name, minKm, maxKm, active } = req.body;
    const slab = await prisma.fareSlab.update({
      where: { id: req.params.id },
      data: { ...(price !== undefined && { price }), ...(name && { name }), ...(minKm !== undefined && { minKm }), ...(maxKm !== undefined && { maxKm }), ...(active !== undefined && { active }) },
    });
    res.json(slab);
  } catch (err) {
    console.error('[Admin:updateSlab]', err);
    res.status(500).json({ error: 'Failed to update slab' });
  }
});

router.delete('/slabs/:id', auth, requireRole('SUPER_ADMIN'), async (req, res) => {
  try {
    await prisma.fareSlab.update({ where: { id: req.params.id }, data: { active: false } });
    res.json({ message: 'Slab deactivated' });
  } catch (err) {
    console.error('[Admin:deleteSlab]', err);
    res.status(500).json({ error: 'Failed to delete slab' });
  }
});

// GET /admin/active-rides - all non-terminal rides with full details
router.get('/active-rides', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const rides = await prisma.ride.findMany({
      where: { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      include: {
        passenger: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, employeeId: true } },
        vehicle: { select: { id: true, plateNumber: true, model: true } },
        slab: true,
      },
      orderBy: { scheduledAt: 'asc' },
    });
    res.json(rides);
  } catch (err) {
    console.error('[Admin:activeRides]', err);
    res.status(500).json({ error: 'Failed to get active rides' });
  }
});

// POST /admin/reassign - reassign a ride to a different driver/vehicle
router.post('/reassign', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { rideId, driverId, vehicleId } = req.body;
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (!['ASSIGNED', 'EN_ROUTE'].includes(ride.status)) {
      return res.status(400).json({ error: 'Can only reassign ASSIGNED or EN_ROUTE rides' });
    }

    // Conflict check on new driver
    const conflictWindow = 2 * 60 * 60 * 1000;
    const conflicts = await prisma.ride.findMany({
      where: {
        driverId,
        id: { not: rideId },
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        scheduledAt: {
          gte: new Date(ride.scheduledAt.getTime() - conflictWindow),
          lte: new Date(ride.scheduledAt.getTime() + conflictWindow),
        },
      },
    });
    if (conflicts.length > 0) {
      return res.status(409).json({ error: 'New driver has conflicting rides', conflicts: conflicts.map(c => ({ id: c.id, scheduledAt: c.scheduledAt })) });
    }

    const oldDriverId = ride.driverId;

    await prisma.ride.update({
      where: { id: rideId },
      data: {
        driverId,
        ...(vehicleId && { vehicleId }),
        status: 'ASSIGNED',
        version: ride.version + 1,
      },
    });

    await prisma.rideEvent.create({
      data: {
        rideId, fromState: ride.status, toState: 'ASSIGNED', actor: req.user.id,
        metadata: { reassigned: true, oldDriverId, newDriverId: driverId },
      },
    });

    const result = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { passenger: { select: { id: true, name: true } }, driver: { select: { id: true, name: true } }, vehicle: true },
    });

    await Promise.all([
      publish(`driver:${driverId}`, 'ride_assigned', { rideId, passenger: result.passenger, pickupAddress: result.pickupAddress, scheduledAt: result.scheduledAt }),
      oldDriverId && publish(`driver:${oldDriverId}`, 'ride_update', { rideId, reassigned: true }),
      publish(`ride:${rideId}`, 'driver_assigned', { rideId, driver: result.driver, vehicle: result.vehicle }),
      publish('fleet', 'ride_reassigned', { rideId, oldDriverId, newDriverId: driverId }),
    ]);

    res.json(result);
  } catch (err) {
    console.error('[Admin:reassign]', err);
    res.status(500).json({ error: 'Failed to reassign ride' });
  }
});

// POST /admin/cancel-ride - admin cancels any ride
router.post('/cancel-ride', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const { rideId, reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    if (['COMPLETED', 'CANCELLED'].includes(ride.status)) {
      return res.status(400).json({ error: `Cannot cancel a ${ride.status} ride` });
    }

    await prisma.ride.update({
      where: { id: rideId },
      data: { status: 'CANCELLED', cancelReason: reason, version: ride.version + 1 },
    });

    await prisma.rideEvent.create({
      data: { rideId, fromState: ride.status, toState: 'CANCELLED', actor: req.user.id, metadata: { reason, cancelledByAdmin: true } },
    });

    await Promise.all([
      publish(`ride:${rideId}`, 'ride_cancelled', { rideId, reason }),
      ride.driverId && publish(`driver:${ride.driverId}`, 'ride_update', { rideId, cancelled: true }),
      publish('fleet', 'ride_cancelled', { rideId, reason }),
    ]);

    res.json({ message: 'Ride cancelled', rideId });
  } catch (err) {
    console.error('[Admin:cancelRide]', err);
    res.status(500).json({ error: 'Failed to cancel ride' });
  }
});

// GET /admin/vehicles/:id/detail - vehicle detail with battery logs + trip stats
router.get('/vehicles/:id/detail', auth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id: req.params.id },
      include: { currentDriver: { select: { id: true, name: true, employeeId: true } } },
    });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [batteryLogs, todayTrips, todayRides] = await Promise.all([
      prisma.batteryLog.findMany({
        where: { vehicleId: req.params.id },
        include: { driver: { select: { id: true, name: true, employeeId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.ride.count({
        where: { vehicleId: req.params.id, status: 'COMPLETED', completedAt: { gte: today } },
      }),
      prisma.ride.findMany({
        where: { vehicleId: req.params.id, status: 'COMPLETED', completedAt: { gte: today } },
        select: { slab: { select: { maxKm: true } } },
      }),
    ]);

    const kmToday = todayRides.reduce((sum, r) => sum + (r.slab?.maxKm || 0), 0);

    res.json({ ...vehicle, batteryLogs, todayTrips, kmToday });
  } catch (err) {
    console.error('[Admin:vehicleDetail]', err);
    res.status(500).json({ error: 'Failed to get vehicle detail' });
  }
});

module.exports = router;
