import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';

test('admin review authorization, concurrent decisions, audit, rollback, revocation and provider visibility', async () => {
  const ids = Array.from({ length: 55 }, () => randomUUID());
  const tokens = Array.from({ length: 5 }, () => sessionToken());
  const origin = 'http://127.0.0.1:3000';
  let server;
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call(path, { method = 'GET', token = tokens[0], data, requestOrigin = origin,
    contentType = 'application/json', raw } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType,
        ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const queue = '/api/admin/provider-applications';
  const decide = (id, data, extra = {}) => call(`${queue}/${id}`, { method: 'POST', data, ...extra });
  try {
    const db = getDatabase();
    await db.account.createMany({ data: ids.map((id, i) => ({ id, email: `admin-test-${id}@example.test`,
      passwordHash: 'test-only-unusable-hash', isAdmin: i < 2 })) });
    await db.providerApplication.createMany({ data: ids.map(accountId => ({ accountId, providerType: 'OWNER' })) });
    await db.session.createMany({ data: tokens.map((token, i) => ({ tokenHash: digest(token), accountId: ids[i], expiresAt: new Date(Date.now() + 600000) })) });
    await start();
    assert.equal((await call(queue, { token: '' })).status, 401);
    assert.equal((await call(queue, { token: tokens[2] })).status, 403);
    assert.deepEqual((await call('/api/admin/access', { token: tokens[2] })).body, { isAdmin: false });
    assert.equal((await decide(ids[3], { decision: 'APPROVED' }, { token: tokens[2] })).status, 403);
    assert.equal((await call('/api/profile', { method: 'PUT', token: tokens[2], data: { displayName: 'Name', isAdmin: true } })).status, 400);
    assert.equal((await call(`${queue}/${ids[3]}`, { token: tokens[2] })).status, 403);
    assert.equal((await decide(ids[0], { decision: 'APPROVED' })).status, 403);
    assert.equal((await decide(ids[0].toUpperCase(), { decision: 'APPROVED' })).status, 403);
    assert.equal((await decide(ids[2], { decision: 'APPROVED' }, { requestOrigin: 'https://attacker.example' })).status, 403);
    assert.equal((await decide(ids[2], { decision: 'APPROVED' }, { requestOrigin: '' })).status, 403);
    assert.equal((await decide(ids[2], {}, { contentType: 'text/plain' })).status, 415);
    assert.equal((await decide(ids[2], {}, { raw: '{invalid' })).status, 400);
    assert.equal((await decide(ids[2], {}, { raw: 'a'.repeat(5000) })).status, 413);
    assert.equal((await decide(ids[2], { decision: 'REJECTED' })).status, 400);
    assert.equal((await decide(ids[2], { decision: 'APPROVED', reviewerId: ids[1] })).status, 400);
    assert.equal((await decide(randomUUID(), { decision: 'APPROVED' })).status, 404);
    assert.equal((await decide('invalid', { decision: 'APPROVED' })).status, 400);
    assert.equal((await call(queue, { method: 'POST' })).status, 405);
    assert.equal((await call(`${queue}?cursor=bad`)).status, 400);
    const pages = [];
    let cursor = null;
    do {
      const page = await call(queue + (cursor ? `?cursor=${cursor}` : ''));
      assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
      assert.ok(page.body.applications.length <= 50);
      pages.push(...page.body.applications); cursor = page.body.nextCursor;
    } while (cursor);
    assert.equal(new Set(pages.map(row => row.accountId)).size, pages.length);
    assert.equal(pages.filter(row => ids.includes(row.accountId)).length, 54);
    assert.ok(pages.every(row => row.accountId !== ids[0] && !('passwordHash' in row.account)));
    const approved = await Promise.all(Array.from({ length: 3 }, () => decide(ids[2], { decision: 'APPROVED' })));
    assert.ok(approved.every(result => result.status === 200));
    for (const result of approved) assert.deepEqual(result.body, approved[0].body);
    assert.equal(await db.providerReview.count({ where: { accountId: ids[2] } }), 1);
    const audit = approved[0].body.application.review;
    assert.equal(audit.reviewerId, ids[0]);
    assert.equal(audit.decision, 'APPROVED');
    const raced = await Promise.all([
      decide(ids[3], { decision: 'APPROVED' }),
      decide(ids[3], { decision: 'REJECTED', reason: 'Please correct the provider type.' }, { token: tokens[1] }),
    ]);
    assert.deepEqual(raced.map(result => result.status).sort(), [200, 409]);
    const rejected = await decide(ids[4], { decision: 'REJECTED', reason: 'Please correct the provider type.' });
    assert.equal(rejected.status, 200);
    assert.equal((await decide(ids[4], { decision: 'APPROVED' })).status, 409);
    // An existing audit forces nested insertion failure; the status update must roll back.
    await db.providerReview.create({ data: { accountId: ids[5], reviewerId: ids[0], decision: 'APPROVED' } });
    assert.equal((await decide(ids[5], { decision: 'APPROVED' })).status, 503);
    assert.equal((await db.providerApplication.findUniqueOrThrow({ where: { accountId: ids[5] } })).status, 'PENDING');
    await db.providerReview.delete({ where: { accountId: ids[5] } });
    async function constraint(operation, expected) {
      const rollback = new Error('Constraint accepted invalid review');
      await assert.rejects(db.$transaction(async tx => { await operation(tx); throw rollback; }), error => {
        assert.notEqual(error, rollback);
        assert.equal(error.code, 'P2010');
        assert.equal(error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode, expected);
        return true;
      });
    }
    await constraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.provider_review ("accountId", "reviewerId", decision) VALUES (${ids[5]}::uuid, ${ids[0]}::uuid, 'PENDING')`, '23514');
    await constraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.provider_review ("accountId", "reviewerId", decision) VALUES (${ids[5]}::uuid, ${ids[0]}::uuid, 'REJECTED')`, '23514');
    await constraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.provider_review ("accountId", "reviewerId", decision) VALUES (${ids[5]}::uuid, ${ids[5]}::uuid, 'APPROVED')`, '23514');
    await constraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.provider_review ("accountId", "reviewerId", decision) VALUES (${ids[2]}::uuid, ${ids[0]}::uuid, 'APPROVED')`, '23505');
    await constraint(tx => tx.$executeRaw`INSERT INTO akgebeya_foundation.provider_review ("accountId", "reviewerId", decision) VALUES (${ids[5]}::uuid, ${randomUUID()}::uuid, 'APPROVED')`, '23503');
    assert.equal(await db.providerReview.count({ where: { accountId: ids[5] } }), 0);
    await stop(); await disconnectDatabase(); await start();
    const own = await call('/api/provider-application', { token: tokens[4] });
    assert.equal(own.body.application.status, 'REJECTED');
    assert.equal(own.body.application.review.reason, 'Please correct the provider type.');
    assert.ok(!('reviewerId' in own.body.application.review));
    const replay = await call('/api/provider-application', { token: tokens[4], method: 'POST', data: { providerType: 'OWNER' } });
    assert.deepEqual(replay.body, own.body);
    assert.deepEqual((await call(`${queue}/${ids[2]}`)).body.application.review, audit);
    await getDatabase().account.update({ where: { id: ids[0] }, data: { isAdmin: false } });
    assert.equal((await call(queue)).status, 403);
    assert.equal((await decide(ids[6], { decision: 'APPROVED' })).status, 403);
    await getDatabase().session.update({ where: { tokenHash: digest(tokens[1]) }, data: { expiresAt: new Date(0) } });
    assert.equal((await call(queue, { token: tokens[1] })).status, 401);
    await getDatabase().session.delete({ where: { tokenHash: digest(tokens[0]) } });
    assert.equal((await call(queue)).status, 401);
  } finally {
    if (server?.listening) await stop();
    await getDatabase().providerApplication.deleteMany({ where: { accountId: { in: ids } } });
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    await disconnectDatabase();
  }
});
