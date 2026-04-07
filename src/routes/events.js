const { asyncRouter } = require('../middleware/asyncRouter');
const prisma = require('../config/database');
const { auth, requireRole } = require('../middleware/auth');
const { subscribe } = require('../sse/manager');
const { ADMIN_ROLES, isAdmin, canViewRide } = require('../services/access');

const router = asyncRouter();

// GET /events/ride/:id - passenger subscribes to ride updates
router.get('/ride/:id', auth, async (req, res) => {
  const ride = await prisma.ride.findUnique({
    where: { id: req.params.id },
    select: { passengerId: true, driverId: true },
  }).catch(() => null);
  if (!ride || !canViewRide(req.user, ride)) return res.status(404).json({ error: 'Ride not found' });
  subscribe(`ride:${req.params.id}`, req, res);
});

// GET /events/driver/:id - driver subscribes to their own assignment notifications
router.get('/driver/:id', auth, (req, res) => {
  if (req.user.id !== req.params.id && !isAdmin(req.user)) {
    return res.status(403).json({ error: 'Cannot subscribe to another driver' });
  }
  subscribe(`driver:${req.params.id}`, req, res);
});

// GET /events/fleet - admin subscribes to all fleet events
router.get('/fleet', auth, requireRole(...ADMIN_ROLES), (req, res) => {
  subscribe('fleet', req, res);
});

module.exports = router;
