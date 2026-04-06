const { Router } = require('express');
const prisma = require('../config/database');
const { redis } = require('../config/redis');
const { auth, requireRole } = require('../middleware/auth');
const { idempotent } = require('../middleware/idempotent');
const { canTransition, MIN_BOOKING_HOURS, CANCELLATION_WINDOW_HOURS } = require('../services/stateMachine');
const { publish } = require('../sse/manager');

const router = Router();

// POST /rides - book a ride (passenger)
router.post('/', auth, requireRole('PASSENGER'), idempotent(), async (req, res) => {
  try {
    const { pickupAddress, pickupLat, pickupLng, dropAddress, dropLat, dropLng, scheduledAt, slabId } = req.body;

    // Validate minimum booking window
    const scheduledDate = new Date(scheduledAt);
    const minTime = new Date(Date.now() + MIN_BOOKING_HOURS * 60 * 60 * 1000);
    if (scheduledDate < minTime) {
      return res.status(400).json({ error: `Must book at least ${MIN_BOOKING_HOURS} hours in advance` });
    }

    // Validate slab exists
    const slab = await prisma.fareSlab.findUnique({ where: { id: slabId } });
    if (!slab || !slab.active) return res.status(400).json({ error: 'Invalid fare slab' });

    const ride = await prisma.ride.create({
      data: {
        pickupAddress,
        pickupLat,
        pickupLng,
        dropAddress,
        dropLat,
        dropLng,
        scheduledAt: scheduledDate,
        fare: slab.price,
        passengerId: req.user.id,
        slabId,
      },
      include: { slab: true },
    });

    // Event sourcing: log creation
    await prisma.rideEvent.create({
      data: {
        rideId: ride.id,
        toState: 'BOOKED',
        actor: req.user.id,
        metadata: { pickupAddress, dropAddress, fare: slab.price },
      },
    });

    // Publish to fleet channel for admin dashboard
    await publish('fleet', 'ride_booked', {
      rideId: ride.id,
      pickupAddress,
      scheduledAt: ride.scheduledAt,
      fare: ride.fare,
    });

    res.status(201).json(ride);
  } catch (err) {
    console.error('[Rides:create]', err);
    res.status(500).json({ error: 'Failed to create ride' });
  }
});

// GET /rides - list rides (filtered by role)
router.get('/', auth, async (req, res) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;
    const where = {};

    if (req.user.role === 'PASSENGER') where.passengerId = req.user.id;
    else if (req.user.role === 'DRIVER') where.driverId = req.user.id;
    // ADMIN/SUPER_ADMIN see all

    if (status) where.status = status;

    const rides = await prisma.ride.findMany({
      where,
      include: { slab: true, passenger: { select: { id: true, name: true, phone: true } }, driver: { select: { id: true, name: true, phone: true } }, vehicle: { select: { id: true, plateNumber: true, model: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: Number(limit),
      skip: Number(offset),
    });

    res.json(rides);
  } catch (err) {
    console.error('[Rides:list]', err);
    res.status(500).json({ error: 'Failed to list rides' });
  }
});

// GET /rides/:id - ride detail with event history
router.get('/:id', auth, async (req, res) => {
  try {
    const ride = await prisma.ride.findUnique({
      where: { id: req.params.id },
      include: {
        slab: true,
        passenger: { select: { id: true, name: true, phone: true } },
        driver: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, plateNumber: true, model: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });
    res.json(ride);
  } catch (err) {
    console.error('[Rides:get]', err);
    res.status(500).json({ error: 'Failed to get ride' });
  }
});

// PATCH /rides/:id/status - transition ride status (driver or admin)
router.patch('/:id/status', auth, idempotent(), async (req, res) => {
  try {
    const { status: newStatus } = req.body;
    if (!newStatus) return res.status(400).json({ error: 'Status required' });

    const ride = await prisma.ride.findUnique({ where: { id: req.params.id } });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });

    // State machine validation
    if (!canTransition(ride.status, newStatus)) {
      return res.status(400).json({
        error: `Cannot transition from ${ride.status} to ${newStatus}`,
        validTransitions: require('../services/stateMachine').RIDE_TRANSITIONS[ride.status],
      });
    }

    // Optimistic concurrency: version check
    const expectedVersion = req.body.version ?? ride.version;
    const updateData = {
      status: newStatus,
      version: { increment: 1 },
    };

    if (newStatus === 'IN_PROGRESS') updateData.startedAt = new Date();
    if (newStatus === 'COMPLETED') updateData.completedAt = new Date();

    const updated = await prisma.ride.updateMany({
      where: { id: ride.id, version: expectedVersion },
      data: {
        status: newStatus,
        version: ride.version + 1,
        ...(newStatus === 'IN_PROGRESS' && { startedAt: new Date() }),
        ...(newStatus === 'COMPLETED' && { completedAt: new Date() }),
      },
    });

    if (updated.count === 0) {
      return res.status(409).json({ error: 'Concurrent modification - retry with latest version' });
    }

    // Event sourcing: append transition
    await prisma.rideEvent.create({
      data: {
        rideId: ride.id,
        fromState: ride.status,
        toState: newStatus,
        actor: req.user.id,
      },
    });

    // Update vehicle status on ride transitions
    if (ride.vehicleId) {
      if (newStatus === 'EN_ROUTE') {
        await prisma.vehicle.update({
          where: { id: ride.vehicleId },
          data: { status: 'ON_RIDE' },
        });
      } else if (newStatus === 'COMPLETED') {
        await prisma.vehicle.update({
          where: { id: ride.vehicleId },
          data: { status: 'AVAILABLE' },
        });
      }
    }

    // Publish to relevant channels
    const eventData = { rideId: ride.id, from: ride.status, to: newStatus, timestamp: new Date() };
    await Promise.all([
      publish(`ride:${ride.id}`, 'status_change', eventData),
      publish('fleet', 'ride_status_change', eventData),
      ride.driverId && publish(`driver:${ride.driverId}`, 'ride_update', eventData),
    ]);

    const result = await prisma.ride.findUnique({
      where: { id: ride.id },
      include: { slab: true, passenger: { select: { id: true, name: true } }, driver: { select: { id: true, name: true } } },
    });

    res.json(result);
  } catch (err) {
    console.error('[Rides:status]', err);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// PATCH /rides/:id/cancel - cancel a ride
router.patch('/:id/cancel', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Cancel reason required' });

    const ride = await prisma.ride.findUnique({ where: { id: req.params.id } });
    if (!ride) return res.status(404).json({ error: 'Ride not found' });

    if (!canTransition(ride.status, 'CANCELLED')) {
      return res.status(400).json({ error: `Cannot cancel a ride in ${ride.status} state` });
    }

    // Check cancellation window (passengers only)
    if (req.user.role === 'PASSENGER') {
      const hoursUntilPickup = (new Date(ride.scheduledAt) - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilPickup < CANCELLATION_WINDOW_HOURS) {
        return res.status(400).json({ error: `Cannot cancel within ${CANCELLATION_WINDOW_HOURS} hours of pickup` });
      }
    }

    await prisma.ride.update({
      where: { id: ride.id },
      data: { status: 'CANCELLED', cancelReason: reason, version: ride.version + 1 },
    });

    await prisma.rideEvent.create({
      data: {
        rideId: ride.id,
        fromState: ride.status,
        toState: 'CANCELLED',
        actor: req.user.id,
        metadata: { reason },
      },
    });

    if (ride.vehicleId) {
      await prisma.vehicle.update({
        where: { id: ride.vehicleId },
        data: { status: 'AVAILABLE' },
      });
    }

    await publish(`ride:${ride.id}`, 'ride_cancelled', { rideId: ride.id, reason });
    await publish('fleet', 'ride_cancelled', { rideId: ride.id, reason });

    res.json({ message: 'Ride cancelled', rideId: ride.id });
  } catch (err) {
    console.error('[Rides:cancel]', err);
    res.status(500).json({ error: 'Failed to cancel ride' });
  }
});

module.exports = router;
