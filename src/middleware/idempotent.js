const { redis } = require('../config/redis');

// Idempotency key middleware
// Client sends X-Idempotency-Key header, we check Redis before processing
function idempotent(ttlSeconds = 86400) {
  return async (req, res, next) => {
    const key = req.headers['x-idempotency-key'];
    if (!key) return next(); // no key = no idempotency check

    const cacheKey = `idempotency:${key}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      const response = JSON.parse(cached);
      return res.status(response.status).json(response.body);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      redis.setex(cacheKey, ttlSeconds, JSON.stringify({
        status: res.statusCode,
        body,
      }));
      return originalJson(body);
    };

    next();
  };
}

module.exports = { idempotent };
