import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';
import { createGeocoder } from '../../apps/api/src/geocoding.ts';

test('listing fee is fixed by server policy, private, eligibility-gated and read-only across property types and source versions', async () => {
  const ids = [randomUUID(), randomUUID()], tokens = ids.map(() => sessionToken());
  const origin = 'http://127.0.0.1:3000'; const listingIds = Array.from({ length: 4 }, () => randomUUID());
  const requestIds = listingIds.map(() => randomUUID());
  let server, index = 0;
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, createGeocoder({ key: () => undefined })));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], path = `/api/listings/${listingIds[index]}/fee`, data } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data ?? {}) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  function checkFee(result, sourceVersion) {
    assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(result.body).sort(), ['listingId', 'sourceVersion', 'currency', 'amount', 'policyRevision', 'calculatedAt'].sort());
    assert.equal(result.body.listingId, listingIds[index]); assert.equal(result.body.sourceVersion, sourceVersion);
    assert.equal(result.body.currency, 'ETB'); assert.equal(result.body.amount, '1000.00');
    assert.equal(result.body.policyRevision, 'flat-etb-1000-v1'); assert.ok(Number.isFinite(Date.parse(result.body.calculatedAt)));
    const serialized = JSON.stringify(result.body);
    for (const secret of [...ids, ...tokens, ...requestIds, 'passwordHash', 'email', 'latitude', 'longitude', 'paymentId', 'transactionId']) {
      assert.equal(serialized.includes(secret), false);
    }
  }
  async function storage() {
    return {
      listings: await getDatabase().listingDraft.findMany({ where: { id: { in: listingIds } }, orderBy: { id: 'asc' } }),
      media: await getDatabase().listingMedia.count({ where: { listingId: { in: listingIds } } }),
      copy: await getDatabase().listingAiContent.count({ where: { listingId: { in: listingIds } } }),
    };
  }
  try {
    for (const [i, id] of ids.entries()) await getDatabase().account.create({ data: {
      id, email: `fee-${id}@example.test`, passwordHash: 'test-only-unusable-hash',
      sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
      providerApplication: { create: { providerType: 'OWNER', status: 'APPROVED' } },
    } });
    const propertyTypes = ['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL'];
    for (const [i, id] of listingIds.entries()) {
      const propertyType = propertyTypes[i], transactionType = i % 2 ? 'SALE' : 'RENT';
      await getDatabase().listingDraft.create({ data: {
        id, accountId: ids[0], requestId: requestIds[i], title: `Fee fixture ${propertyType}`, transactionType, propertyType,
        creationPayload: { title: `Fee fixture ${propertyType}`, transactionType, propertyType },
        status: 'COMPLETE', description: 'Synthetic property fixture for fee calculation verification.',
        priceEtb: i === 1 ? '999999999999.99' : '1.00', areaSqm: '70.00',
        bedrooms: i < 2 ? 1 : null, bathrooms: i < 2 ? 1 : null,
        countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city', subcityId: 'bole', latitude: 8.995123, longitude: 38.785456,
      } });
    }
    await start();
    assert.equal((await call({ token: '' })).status, 401);
    assert.equal((await call({ token: sessionToken() })).status, 401);
    assert.equal((await call({ token: tokens[1] })).status, 404);
    assert.equal((await call({ path: `/api/listings/${randomUUID()}/fee` })).status, 404);
    assert.equal((await call({ path: '/api/listings/not-a-uuid/fee' })).status, 400);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const wrong = await call({ method, data: { amount: '0.01', currency: 'USD' } });
      assert.equal(wrong.status, 405); assert.equal(wrong.headers.get('allow'), 'GET');
    }
    const before = await storage();
    for (index = 0; index < listingIds.length; index++) {
      checkFee(await call(), 1);
      checkFee(await call({ path: `/api/listings/${listingIds[index]}/fee?amount=0.01&currency=USD&policyRevision=free&sourceVersion=999&accountId=${ids[1]}` }), 1);
    }
    index = 0;
    checkFee(await call(), 1); checkFee(await call(), 1);
    assert.deepEqual(await storage(), before);
    await stop(); await disconnectDatabase(); await start();
    checkFee(await call(), 1); assert.deepEqual(await storage(), before);
    const edited = await call({ method: 'PUT', path: `/api/listings/${listingIds[0]}`, data: {
      version: 1, title: 'Updated fee source', transactionType: 'SALE', propertyType: 'APARTMENT',
      description: 'Synthetic updated property details for fee verification.', priceEtb: '10000000.00', areaSqm: '100.00',
      bedrooms: 2, bathrooms: 1, complete: true,
    } });
    assert.equal(edited.status, 200); assert.equal(edited.body.listing.version, 2); checkFee(await call(), 2);
    const changed = await storage(); checkFee(await call(), 2); assert.deepEqual(await storage(), changed);
    await getDatabase().listingDraft.update({ where: { id: listingIds[0] }, data: { status: 'DRAFT' } });
    assert.equal((await call()).status, 409);
    await getDatabase().listingDraft.update({ where: { id: listingIds[0] }, data: { status: 'COMPLETE' } });
    for (const status of ['PENDING', 'REJECTED']) {
      await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status } });
      assert.equal((await call()).status, 403);
    }
    await getDatabase().providerApplication.delete({ where: { accountId: ids[0] } });
    assert.equal((await call()).status, 403);
    await getDatabase().session.update({ where: { tokenHash: digest(tokens[0]) }, data: { expiresAt: new Date(0) } });
    assert.equal((await call()).status, 401);
  } finally {
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    await disconnectDatabase();
  }
});
