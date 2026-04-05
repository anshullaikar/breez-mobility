const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Main client for commands: GET, SET, GEOADD, SETNX etc
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
});

// Separate client for pub/sub subscriptions
// (a subscribed client can't run normal commands)
const redisSub = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
});

redis.on('error', (err) => console.error('[Redis:cmd]', err.message));
redis.on('connect', () => console.log('[Redis:cmd] Connected'));
redisSub.on('error', (err) => console.error('[Redis:sub]', err.message));
redisSub.on('connect', () => console.log('[Redis:sub] Connected'));

module.exports = { redis, redisSub };
