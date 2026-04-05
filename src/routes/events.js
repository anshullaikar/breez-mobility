const { Router } = require('express');
const { auth } = require('../middleware/auth');
const { subscribe } = require('../sse/manager');

const router = Router();

// GET /events/ride/:id - passenger subscribes to ride updates
router.get('/ride/:id', auth, (req, res) => {
  subscribe(`ride:${req.params.id}`, req, res);
});

// GET /events/driver/:id - driver subscribes to assignment notifications
router.get('/driver/:id', auth, (req, res) => {
  subscribe(`driver:${req.params.id}`, req, res);
});

// GET /events/fleet - admin subscribes to all fleet events
router.get('/fleet', auth, (req, res) => {
  subscribe('fleet', req, res);
});

module.exports = router;
