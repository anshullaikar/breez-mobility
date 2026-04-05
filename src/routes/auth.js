const { Router } = require('express');
const { redis } = require('../config/redis');
const prisma = require('../config/database');
const { generateToken } = require('../middleware/auth');

const router = Router();

// POST /auth/send-otp
router.post('/send-otp', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone required' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await redis.setex(`otp:${phone}`, 300, code); // 5 min TTL

  // TODO: fire WhatsApp API call here
  // For POC, just log it
  console.log(`[OTP] ${phone} -> ${code}`);

  res.json({ message: 'OTP sent', ...(process.env.NODE_ENV === 'development' && { code }) });
});

// POST /auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { phone, code, name, dob } = req.body;
  if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });

  const stored = await redis.get(`otp:${phone}`);
  if (!stored) return res.status(400).json({ error: 'OTP expired or not found' });
  if (stored !== code) return res.status(400).json({ error: 'Invalid OTP' });

  await redis.del(`otp:${phone}`);

  // Upsert user
  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) {
    if (!name) return res.status(400).json({ error: 'Name required for first login' });
    user = await prisma.user.create({
      data: {
        phone,
        name,
        dob: dob ? new Date(dob) : null,
        role: 'PASSENGER',
      },
    });
  }

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, phone: user.phone } });
});

// POST /auth/driver-login (employee ID + PIN)
router.post('/driver-login', async (req, res) => {
  const { employeeId, pin } = req.body;
  if (!employeeId || !pin) return res.status(400).json({ error: 'Employee ID and PIN required' });

  const user = await prisma.user.findUnique({ where: { employeeId } });
  if (!user || user.role !== 'DRIVER') return res.status(401).json({ error: 'Invalid credentials' });
  if (user.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });
  if (!user.active) return res.status(403).json({ error: 'Account deactivated' });

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role, employeeId: user.employeeId } });
});

// POST /auth/admin-login (simple email-like login for POC)
router.post('/admin-login', async (req, res) => {
  const { phone, pin } = req.body;
  if (!phone || !pin) return res.status(400).json({ error: 'Phone and PIN required' });

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.pin !== pin) return res.status(401).json({ error: 'Invalid PIN' });

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

module.exports = router;
