require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initSSE } = require('./sse/manager');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/rides', require('./routes/rides'));
app.use('/admin', require('./routes/admin'));
app.use('/drivers', require('./routes/drivers'));
app.use('/events', require('./routes/events'));

// Health check
app.get('/health', async (req, res) => {
  const prisma = require('./config/database');
  const { redis } = require('./config/redis');
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.json({ status: 'ok', postgres: 'connected', redis: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Init SSE pub/sub listener
initSSE();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Breez] Server running on port ${PORT}`);
  console.log(`[Breez] Live map: http://localhost:${PORT}/map.html`);
  console.log(`[Breez] Dashboard: http://localhost:${PORT}/dashboard.html`);
});
