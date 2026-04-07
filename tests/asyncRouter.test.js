const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { asyncRouter } = require('../src/middleware/asyncRouter');

describe('asyncRouter', () => {
  let server, base;

  before(async () => {
    const app = express();
    const router = asyncRouter();
    router.get('/rejects', async () => { throw new Error('async boom'); });
    router.get('/throws', () => { throw new Error('sync boom'); });
    router.get('/ok', async (req, res) => res.json({ ok: true }));
    app.use(router);
    app.use((err, req, res, next) => res.status(500).json({ caught: err.message }));
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
  });

  after(() => server.close());

  it('forwards rejected promises to the error handler', async () => {
    const res = await fetch(`${base}/rejects`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { caught: 'async boom' });
  });

  it('forwards synchronous throws to the error handler', async () => {
    const res = await fetch(`${base}/throws`);
    assert.deepEqual(await res.json(), { caught: 'sync boom' });
  });

  it('leaves successful handlers alone', async () => {
    const res = await fetch(`${base}/ok`);
    assert.deepEqual(await res.json(), { ok: true });
  });
});
