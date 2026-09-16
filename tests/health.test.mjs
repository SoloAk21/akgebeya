import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { once } from 'node:events';
import { createHealthServer } from '../apps/api/src/server.ts';
import { fetchHealth } from '../apps/web/src/health.ts';

const server = createHealthServer();
let base;
before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

test('public health requests return uncached, valid server responses repeatedly', async () => {
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    const data = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ['service', 'status', 'timestamp']);
    assert.equal(data.status, 'ok');
    assert.equal(data.service, 'akgebeya-api');
    assert.ok(Math.abs(Date.now() - Date.parse(data.timestamp)) < 5000);
  }
});

test('HEAD, query strings, unsupported methods, and unknown routes', async () => {
  const head = await fetch(`${base}/api/health`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${base}/api/health?check=1`)).status, 200);
  const post = await fetch(`${base}/api/health`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.deepEqual(await post.json(), { error: 'METHOD_NOT_ALLOWED' });
  const missing = await fetch(`${base}/api/missing`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'NOT_FOUND' });
});

test('browser client consumes the real backend response with a timeout and no cache', async () => {
  const data = await fetchHealth((path, options) => {
    assert.equal(path, '/api/health');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal);
    return fetch(`${base}${path}`, options);
  });
  assert.equal(data.service, 'akgebeya-api');
});

test('browser client rejects unavailable, malformed, and misleading responses', async () => {
  await assert.rejects(fetchHealth(async () => { throw new Error('Network unavailable'); }));
  await assert.rejects(fetchHealth(async () => ({ ok: false })));
  for (const payload of [null, {}, { status: 'ok', service: 'other', timestamp: new Date().toISOString() },
    { status: 'ok', service: 'akgebeya-api', timestamp: 'invalid' },
    { status: 'failed', service: 'akgebeya-api', timestamp: new Date().toISOString() }]) {
    await assert.rejects(fetchHealth(async () => ({ ok: true, json: async () => payload })));
  }
  await assert.rejects(fetchHealth(async () => ({ ok: true, json: async () => { throw new Error('Bad JSON'); } })));
});
