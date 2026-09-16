import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';

test('profile persists, isolates accounts, rejects unauthorized writes and keeps credentials private', async () => {
  const db = getDatabase();
  const ids = [randomUUID(), randomUUID()];
  const tokens = [sessionToken(), sessionToken()];
  const origin = 'http://127.0.0.1:3000';
  let server;
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], data, requestOrigin = origin, raw, contentType = 'application/json', path = '/api/profile' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType,
        ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  try {
    for (const [i, id] of ids.entries()) {
      await db.account.create({ data: { id, email: `profile-${id}@example.test`, passwordHash: 'profile-test-only-not-a-password-hash',
        sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } } } });
    }
    await start();
    assert.equal((await call({ token: '' })).status, 401);
    assert.equal((await call({ token: sessionToken() })).status, 401);
    const initial = await call();
    assert.equal(initial.status, 200);
    assert.equal(initial.body.profile.displayName, null);
    assert.deepEqual(Object.keys(initial.body.profile).sort(), ['displayName', 'email', 'id']);
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.equal((await call({ method: 'POST' })).status, 405);
    for (const requestOrigin of ['', 'https://attacker.example']) {
      assert.equal((await call({ method: 'PUT', requestOrigin, data: { displayName: 'Wrong' } })).status, 403);
    }
    assert.equal((await call({ method: 'PUT', contentType: 'text/plain' })).status, 415);
    assert.equal((await call({ method: 'PUT', raw: '{invalid' })).status, 400);
    assert.equal((await call({ method: 'PUT', raw: 'a'.repeat(5000) })).status, 413);
    for (const data of [{ displayName: 'Wrong', id: ids[1] }, { displayName: 'Wrong', email: 'wrong@example.test' },
      { displayName: 'Wrong', passwordHash: 'wrong' }, { displayName: 'Wrong', role: 'admin' },
      { displayName: ' ' }, { displayName: 'x'.repeat(81) }]) {
      assert.equal((await call({ method: 'PUT', data })).status, 400);
    }
    assert.equal((await call()).body.profile.displayName, null);
    for (let i = 0; i < 2; i++) {
      const saved = await call({ method: 'PUT', data: { displayName: '  ሰላም ተስፋዬ  ' } });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.profile.displayName, 'ሰላም ተስፋዬ');
    }
    assert.equal((await call({ token: tokens[1] })).body.profile.displayName, null);
    assert.equal((await call({ path: `/api/profile/${ids[1]}` })).status, 404);
    await stop(); await disconnectDatabase(); await start();
    assert.equal((await call()).body.profile.displayName, 'ሰላም ተስፋዬ');
    const row = await getDatabase().account.findUniqueOrThrow({ where: { id: ids[0] } });
    assert.equal(row.email, `profile-${ids[0]}@example.test`);
    assert.equal(row.passwordHash, 'profile-test-only-not-a-password-hash');
    await getDatabase().session.update({ where: { tokenHash: digest(tokens[0]) }, data: { expiresAt: new Date(0) } });
    assert.equal((await call()).status, 401);
    assert.equal((await call({ method: 'PUT', data: { displayName: 'Expired' } })).status, 401);
    await getDatabase().session.delete({ where: { tokenHash: digest(tokens[1]) } });
    assert.equal((await call({ token: tokens[1], method: 'PUT', data: { displayName: 'Revoked' } })).status, 401);
    assert.equal((await getDatabase().account.findUniqueOrThrow({ where: { id: ids[0] } })).displayName, 'ሰላም ተስፋዬ');
  } finally {
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    await disconnectDatabase();
  }
});
