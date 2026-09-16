import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createHealthServer } from '../apps/api/src/server.ts';

async function withServer(readiness, run) {
  const server = createHealthServer(readiness);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('readiness succeeds only after the database check and never caches', async () => {
  let called = 0;
  await withServer(async () => { called++; }, async base => {
    const response = await fetch(`${base}/api/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'ready' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(called, 1);
    const head = await fetch(`${base}/api/ready`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const post = await fetch(`${base}/api/ready`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(called, 2);
  });
});

test('missing configuration and database failures return sanitized 503 without breaking liveness', async () => {
  for (const readiness of [undefined, async () => { throw new Error('postgresql://secret-password@private-host'); }]) {
    await withServer(readiness, async base => {
      const response = await fetch(`${base}/api/ready`);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { status: 'unavailable', database: 'unavailable' });
      assert.equal((await fetch(`${base}/api/health`)).status, 200);
    });
  }
});
