import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';
import { createGeocoder } from '../../apps/api/src/geocoding.ts';
import { ChapaError } from '../../apps/api/src/chapa.ts';

test('listing checkout uses a server-calculated fee and a durable single-attempt record without publishing or duplicating uncertain payments', async () => {
  const ids = [randomUUID(), randomUUID()], tokens = ids.map(() => sessionToken());
  const listingIds = Array.from({ length: 6 }, () => randomUUID());
  const requestIds = listingIds.map(() => randomUUID());
  const origin = 'http://127.0.0.1:3000';
  let server, index = 0, mode = 'wait', calls = 0, release, announce;
  const gatewayInputs = [];
  const checkoutUrl = 'https://checkout.chapa.co/checkout/payment/test-private-checkout';
  const gateway = { assertConfigured() {
    if (mode === 'unconfigured') throw new ChapaError(503, 'CHAPA_NOT_CONFIGURED', 'Synthetic missing test configuration', 'FAILED');
  }, async initialize(input) {
    calls++; gatewayInputs.push(input);
    if (mode === 'wait') { announce(); await new Promise(resolve => { release = resolve; }); }
    if (mode === 'unknown') throw new Error('Synthetic network connection ended after sending request');
    if (mode === 'failed') throw new ChapaError(502, 'CHAPA_REJECTED', 'Synthetic checkout rejection', 'FAILED');
    if (mode === 'invalid-url') return { checkoutUrl: 'https://attacker.example/checkout' };
    return { checkoutUrl };
  } };
  const generator = { model: 'unused-payment-test', async generate() { throw new Error('Payment must not generate listing copy'); } };
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, createGeocoder({ key: () => undefined }), generator, gateway));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], path = `/api/listings/${listingIds[index]}/payment`, data,
    requestOrigin = origin, contentType = 'application/json', raw } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType, ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const input = () => ({ version: 1, requestId: requestIds[index], consent: true });
  const source = () => getDatabase().listingDraft.findMany({ where: { id: { in: listingIds } }, orderBy: { id: 'asc' } });
  try {
    for (const [i, id] of ids.entries()) await getDatabase().account.create({ data: {
      id, email: `payment-${id}@example.test`, passwordHash: 'test-only-unusable-hash',
      sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
      providerApplication: { create: { providerType: 'OWNER', status: 'APPROVED' } },
    } });
    for (const id of listingIds) await getDatabase().listingDraft.create({ data: {
      id, accountId: ids[0], requestId: randomUUID(), title: 'Payment fixture', transactionType: 'SALE', propertyType: 'HOUSE',
      creationPayload: { title: 'Payment fixture', transactionType: 'SALE', propertyType: 'HOUSE' },
      status: 'COMPLETE', description: 'Synthetic complete property for private payment initialization.',
      priceEtb: '999999999999.99', areaSqm: '70.00', bedrooms: 1, bathrooms: 1,
      countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city', subcityId: 'bole', latitude: 8.995123, longitude: 38.785456,
    } });
    await start();
    const initial = await call(); assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, { payment: null, currentVersion: 1, stale: false });
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    assert.equal((await call({ token: '' })).status, 401);
    assert.equal((await call({ token: tokens[1] })).status, 404);
    assert.equal((await call({ path: '/api/listings/not-a-uuid/payment' })).status, 400);
    assert.equal((await call({ method: 'POST', data: input(), token: '' })).status, 401);
    assert.equal((await call({ method: 'POST', data: input(), token: tokens[1] })).status, 404);
    assert.equal((await call({ method: 'PUT', data: input() })).status, 405);
    for (const requestOrigin of ['', 'https://attacker.example']) assert.equal((await call({ method: 'POST', data: input(), requestOrigin })).status, 403);
    for (const data of [null, [], {}, { ...input(), version: '1' }, { ...input(), consent: false },
      { ...input(), requestId: 'invalid' }, { ...input(), amount: '0.01' }, { ...input(), currency: 'USD' },
      { ...input(), checkoutUrl: 'https://attacker.example' }, { ...input(), status: 'PAID' }, { ...input(), accountId: ids[1] }]) {
      assert.equal((await call({ method: 'POST', data })).status, 400);
    }
    assert.equal((await call({ method: 'POST', data: input(), contentType: 'text/plain' })).status, 415);
    assert.equal((await call({ method: 'POST', raw: '{broken' })).status, 400);
    assert.equal((await call({ method: 'POST', raw: 'x'.repeat(5000) })).status, 413);
    assert.equal((await call({ method: 'POST', data: { ...input(), version: 2 } })).status, 409);
    await getDatabase().listingDraft.update({ where: { id: listingIds[0] }, data: { status: 'DRAFT' } });
    assert.equal((await call({ method: 'POST', data: input() })).status, 409);
    await getDatabase().listingDraft.update({ where: { id: listingIds[0] }, data: { status: 'COMPLETE' } });
    await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status: 'PENDING' } });
    assert.equal((await call({ method: 'POST', data: input() })).status, 403);
    await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status: 'APPROVED' } });
    assert.equal(calls, 0); const before = await source();

    const started = new Promise(resolve => { announce = resolve; });
    const pending = call({ method: 'POST', data: input() });
    await Promise.race([started, pending.then(result => { throw new Error(`Checkout failed before gateway: ${result.status}`); })]);
    const concurrent = await call({ method: 'POST', data: { ...input(), requestId: randomUUID() } });
    assert.equal(concurrent.status, 200); assert.equal(concurrent.body.payment.status, 'INITIALIZING');
    assert.equal(calls, 1);
    const initializing = await call(); assert.equal(initializing.body.payment.status, 'INITIALIZING');
    assert.equal(initializing.body.payment.checkoutUrl, null);
    release(); const initialized = await pending; assert.equal(initialized.status, 200);
    const ready = (await call()).body; assert.equal(ready.payment.status, 'READY');
    assert.equal(ready.payment.amount, '1000.00'); assert.equal(ready.payment.currency, 'ETB');
    assert.equal(ready.payment.policyRevision, 'flat-etb-1000-v1'); assert.equal(ready.payment.sourceVersion, 1);
    assert.equal(ready.payment.listingId, listingIds[0]); assert.equal(ready.payment.checkoutUrl, checkoutUrl);
    assert.ok(Number.isFinite(Date.parse(ready.payment.createdAt)));
    assert.equal(gatewayInputs[0].amount, '1000.00'); assert.equal(gatewayInputs[0].currency, 'ETB');
    assert.ok(gatewayInputs[0].reference); assert.ok(gatewayInputs[0].returnUrl);
    assert.equal((await call({ method: 'POST', data: input() })).status, 200);
    assert.equal(calls, 1); assert.deepEqual((await call()).body, ready); assert.deepEqual(await source(), before);
    assert.equal(await getDatabase().listingPayment.count({ where: { listingId: listingIds[0] } }), 1);
    const serialized = JSON.stringify(ready);
    for (const secret of [...ids, ...tokens, ...requestIds, gatewayInputs[0].reference, 'passwordHash', '@example.test', 'secretKey']) assert.equal(serialized.includes(secret), false);
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call()).body, ready);
    assert.equal((await call({ method: 'POST', data: input() })).status, 200); assert.equal(calls, 1);
    await getDatabase().listingDraft.update({ where: { id: listingIds[0] }, data: { mediaVersion: 2 } });
    const mediaChanged = (await call()).body; assert.equal(mediaChanged.stale, true); assert.equal(mediaChanged.payment.checkoutUrl, null);
    assert.equal((await call({ method: 'POST', data: input() })).status, 409); assert.equal(calls, 1);
    await getDatabase().listingDraft.update({ where: { id: listingIds[0] }, data: { version: 2, mediaVersion: 1, title: 'Changed checkout source' } });
    const stale = (await call()).body; assert.equal(stale.stale, true); assert.equal(stale.currentVersion, 2);
    assert.equal(stale.payment.checkoutUrl, null);
    assert.equal((await call({ method: 'POST', data: { ...input(), version: 2, requestId: randomUUID() } })).status, 409);
    assert.equal(calls, 1);

    index = 1; mode = 'unknown';
    assert.equal((await call({ method: 'POST', data: input() })).status, 200);
    const uncertain = (await call()).body; assert.equal(uncertain.payment.status, 'UNKNOWN');
    assert.equal(uncertain.payment.checkoutUrl, null); const failedCalls = calls;
    for (const requestId of [requestIds[1], randomUUID()]) await call({ method: 'POST', data: { ...input(), requestId } });
    assert.equal(calls, failedCalls); assert.deepEqual((await call()).body, uncertain);
    assert.equal(await getDatabase().listingPayment.count({ where: { listingId: listingIds[1] } }), 1);
    assert.equal((await getDatabase().listingDraft.findUniqueOrThrow({ where: { id: listingIds[1] } })).status, 'COMPLETE');
    index = 2; mode = 'unconfigured';
    assert.equal((await call({ method: 'POST', data: input() })).status, 503);
    assert.equal((await call()).body.payment, null); assert.equal(calls, failedCalls);
    mode = 'failed';
    assert.equal((await call({ method: 'POST', data: input() })).status, 200);
    assert.equal((await call()).body.payment.status, 'FAILED'); const rejectedCalls = calls;
    assert.equal((await call({ method: 'POST', data: { ...input(), requestId: randomUUID() } })).status, 200);
    assert.equal(calls, rejectedCalls);
    index = 3; mode = 'invalid-url';
    assert.equal((await call({ method: 'POST', data: input() })).status, 200);
    const invalidLink = (await call()).body.payment;
    assert.equal(invalidLink.status, 'UNKNOWN'); assert.equal(invalidLink.checkoutUrl, null);
    index = 4; mode = 'success';
    assert.equal((await call({ method: 'POST', data: input() })).status, 200);
    assert.equal((await call()).body.payment.status, 'READY');
    const quotaCalls = calls; index = 5;
    assert.equal((await call({ method: 'POST', data: input() })).status, 429);
    assert.equal((await call()).body.payment, null); assert.equal(calls, quotaCalls);
    index = 4;
    assert.equal((await call({ method: 'POST', data: input() })).status, 200); assert.equal(calls, quotaCalls);
    await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status: 'REJECTED' } });
    index = 2;
    assert.equal((await call({ method: 'POST', data: input() })).status, 403); assert.equal(calls, quotaCalls);
    assert.equal((await call()).body.stale, true);
  } finally {
    release?.(); if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    assert.equal(await getDatabase().listingPayment.count({ where: { listingId: { in: listingIds } } }), 0);
    await disconnectDatabase();
  }
});
