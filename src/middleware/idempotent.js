const { redis } = require('../config/redis');

const PENDING = '__pending__';

// Idempotency key middleware
// Client sends X-Idempotency-Key header, we check Redis before processing.
// Must run after auth: keys are scoped per user so two users can't collide.
function idempotent(ttlSeconds = 86400) {
  return async (req, res, next) => {
    const key = req.headers['x-idempotency-key'];
    if (!key) return next(); // no key = no idempotency check

    const cacheKey = `idempotency:${req.user?.id || 'anon'}:${key}`;

    // SET NX claims the key atomically, so concurrent retries can't both run
    const claimed = await redis.set(cacheKey, PENDING, 'EX', 60, 'NX');
    if (!claimed) {
      const cached = await redis.get(cacheKey);
      if (!cached || cached === PENDING) {
        return res.status(409).json({ error: 'A request with this idempotency key is already in progress' });
      }
      const response = JSON.parse(cached);
      return res.status(response.status).json(response.body);
    }

    // Intercept res.json to cache the response
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 500) {
        // Server errors are retryable - release the key
        redis.del(cacheKey);
      } else {
        redis.setex(cacheKey, ttlSeconds, JSON.stringify({ status: res.statusCode, body }));
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = { idempotent };
