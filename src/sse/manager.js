const { redis, redisSub } = require('../config/redis');

// Track active SSE connections: channel -> Set<response>
const channels = new Map();

// Single psubscribe for all channels, fan out to SSE connections
let subscribed = false;

function initSSE() {
  if (subscribed) return;
  subscribed = true;

  redisSub.psubscribe('ride:*', 'driver:*', 'fleet', (err) => {
    if (err) console.error('[SSE] psubscribe error:', err);
    else console.log('[SSE] Listening on ride:*, driver:*, fleet');
  });

  redisSub.on('pmessage', (_pattern, channel, message) => {
    const clients = channels.get(channel);
    if (!clients || clients.size === 0) return;

    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      parsed = { data: message };
    }

    const event = parsed.event || 'update';
    const data = JSON.stringify(parsed.data || parsed);

    for (const res of clients) {
      try {
        res.write(`event: ${event}\ndata: ${data}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  });
}

// Publish an event to a channel (called from route handlers)
function publish(channel, event, data) {
  return redis.publish(channel, JSON.stringify({ event, data }));
}

// SSE endpoint handler factory
function subscribe(channel, req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx compat
  res.flushHeaders();

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ channel })}\n\n`);

  if (!channels.has(channel)) {
    channels.set(channel, new Set());
  }
  channels.get(channel).add(res);

  req.on('close', () => {
    const clients = channels.get(channel);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) channels.delete(channel);
    }
  });
}

// Heartbeat to keep connections alive (every 30s)
setInterval(() => {
  for (const [channel, clients] of channels) {
    for (const res of clients) {
      try {
        res.write(`:heartbeat\n\n`);
      } catch {
        clients.delete(res);
      }
    }
    if (clients.size === 0) channels.delete(channel);
  }
}, 30000);

module.exports = { initSSE, publish, subscribe };
