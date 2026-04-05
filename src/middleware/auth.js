const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'breez-poc-secret';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, phone: user.phone },
    JWT_SECRET,
    { expiresIn: '14h' }
  );
}

function auth(req, res, next) {
  // Support both header and query param (SSE can't set headers)
  const token =
    req.headers.authorization?.replace('Bearer ', '') ||
    req.query.token;

  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { generateToken, auth, requireRole };
