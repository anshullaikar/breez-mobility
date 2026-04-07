const { Router } = require('express');

// Express 4 ignores rejected promises from async handlers; an error thrown
// in one becomes an unhandled rejection, which crashes Node 20+.
// This router forwards those rejections to next(err) instead, where the
// error handler in server.js turns them into a 500.
function forwardRejections(fn) {
  if (typeof fn !== 'function' || fn.length === 4) return fn; // error middleware
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

function asyncRouter() {
  const router = Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const original = router[method].bind(router);
    router[method] = (path, ...handlers) => original(path, ...handlers.map(forwardRejections));
  }
  return router;
}

module.exports = { asyncRouter };
