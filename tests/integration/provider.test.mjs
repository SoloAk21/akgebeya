import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';

test('all provider types persist with isolated status, atomic retries and database constraints', async () => {
  const types = ['OWNER', 'BROKER', 'AGENT', 'AGENCY', 'DEVELOPER'];
  const ids = types.map(() => randomUUID());
  const tokens = types.map(() => sessionToken());
  const origin = 'http://127.0.0.1:3000';
  let server;
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], data, requestOrigin = origin, raw,
    contentType = 'application/json', path = '/api/provider-application' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType,
        ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const apply = (providerType, extra = {}) => call({ method: 'POST', data: { providerType }, ...extra });
  try {
    for (const [i, id] of ids.entries()) {
      await getDatabase().account.create({ data: { id, email: `provider-${id}@example.test`, passwordHash: 'test-only-unusable-hash',
        sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } } } });
    }
    await start();
    assert.equal((await call({ token: '' })).status, 401);
    assert.equal((await apply('OWNER', { token: '' })).status, 401);
    assert.equal((await call({ token: sessionToken() })).status, 401);
    const initial = await call();
    assert.deepEqual(initial.body, { application: null });
    assert.equal(initial.status, 200);
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    const wrongMethod = await call({ method: 'PUT' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET, POST');
    for (const requestOrigin of ['', 'https://attacker.example']) assert.equal((await apply('OWNER', { requestOrigin })).status, 403);
    assert.equal((await apply('OWNER', { contentType: 'text/plain' })).status, 415);
    assert.equal((await apply('OWNER', { raw: '{invalid' })).status, 400);
    assert.equal((await apply('OWNER', { raw: 'x'.repeat(5000) })).status, 413);
    for (const data of [{}, { providerType: 'ADMIN' }, { providerType: 'OWNER', accountId: ids[1] },
      { providerType: 'OWNER', status: 'APPROVED' }, { providerType: 'OWNER', submittedAt: '2020-01-01' }]) {
      assert.equal((await call({ method: 'POST', data })).status, 400);
    }
    assert.equal(await getDatabase().providerApplication.count({ where: { accountId: { in: ids } } }), 0);
    const competing = await Promise.all(Array.from({ length: 5 }, () => apply('OWNER')));
    assert.equal(competing.filter(result => result.status === 201).length, 1);
    assert.equal(competing.filter(result => result.status === 200).length, 4);
    const saved = competing[0].body.application;
    for (const result of competing) assert.deepEqual(result.body.application, saved);
    assert.deepEqual(Object.keys(saved).sort(), ['providerType', 'review', 'status', 'submittedAt']);
    assert.equal(saved.status, 'PENDING');
    assert.ok(Number.isFinite(Date.parse(saved.submittedAt)));
    assert.equal((await call({ token: tokens[1] })).body.application, null);
    assert.equal((await call({ path: `/api/provider-application/${ids[0]}`, token: tokens[1] })).status, 404);
    assert.equal((await apply('BROKER')).status, 409);
    assert.deepEqual((await call()).body.application, saved);
    for (let i = 1; i < types.length; i++) {
      // Competing different types must create one record, with one conflict.
      if (i === 1) {
        const race = await Promise.all([apply('BROKER', { token: tokens[i] }), apply('AGENT', { token: tokens[i] })]);
        assert.deepEqual(race.map(result => result.status).sort(), [201, 409]);
        const winner = race.find(result => result.status === 201).body.application;
        assert.deepEqual((await call({ token: tokens[i] })).body.application, winner);
        // This fixture is exclusively owned by the test; clear it to exercise BROKER deterministically.
        await getDatabase().providerApplication.delete({ where: { accountId: ids[i] } });
      }
      const created = await apply(types[i], { token: tokens[i] });
      assert.equal(created.status, 201);
      assert.equal(created.body.application.providerType, types[i]);
      assert.equal(created.body.application.status, 'PENDING');
    }
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call()).body.application, saved);
    const db = getDatabase();
    assert.equal(await db.providerApplication.count({ where: { accountId: { in: ids } } }), 5);
    const row = await db.account.findUniqueOrThrow({ where: { id: ids[0] }, include: { providerApplication: true } });
    assert.equal(row.providerApplication.accountId, row.id);
    assert.equal(row.passwordHash, 'test-only-unusable-hash');
    async function constraint(operation, expected) {
      const rollback = new Error('Constraint accepted invalid data');
      await assert.rejects(db.$transaction(async tx => { await operation(tx); throw rollback; }), error => {
        assert.notEqual(error, rollback);
        assert.equal(error.code, 'P2010');
        assert.equal(error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode, expected);
        return true;
      });
    }
    await constraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.provider_application ("accountId", "providerType") VALUES (${ids[0]}::uuid, 'OWNER')`, '23505');
    await constraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.provider_application ("accountId", "providerType") VALUES (${randomUUID()}::uuid, 'OWNER')`, '23503');
    await constraint(tx => tx.$executeRaw`UPDATE akgebeya_foundation.provider_application SET "providerType" = 'ADMIN' WHERE "accountId" = ${ids[0]}::uuid`, '22P02');
    await constraint(tx => tx.$executeRaw`UPDATE akgebeya_foundation.provider_application SET status = 'VERIFIED' WHERE "accountId" = ${ids[0]}::uuid`, '22P02');
    // Simulated review results are test fixtures, not an implemented admin route.
    for (const status of ['APPROVED', 'REJECTED']) {
      await db.providerApplication.update({ where: { accountId: ids[0] }, data: { status } });
      const replay = await apply('OWNER');
      assert.equal(replay.status, 200);
      assert.equal(replay.body.application.status, status);
      assert.equal(replay.body.application.submittedAt, saved.submittedAt);
    }
    await db.session.update({ where: { tokenHash: digest(tokens[0]) }, data: { expiresAt: new Date(0) } });
    assert.equal((await call()).status, 401);
    assert.equal((await apply('OWNER')).status, 401);
    await db.session.delete({ where: { tokenHash: digest(tokens[1]) } });
    assert.equal((await apply('BROKER', { token: tokens[1] })).status, 401);
    assert.equal((await db.providerApplication.findUniqueOrThrow({ where: { accountId: ids[0] } })).status, 'REJECTED');
  } finally {
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    assert.equal(await getDatabase().providerApplication.count({ where: { accountId: { in: ids } } }), 0);
    await disconnectDatabase();
  }
});
