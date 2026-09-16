import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';
import { createGeocoder } from '../../apps/api/src/geocoding.ts';
import { Prisma } from '../../apps/api/src/generated/prisma/client.ts';

const location = { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city',
  subcityId: 'bole', latitude: 8.995123, longitude: 38.785456, confirmed: true };
// Synthetic fixture only: no geocoder calls or claims about a real address.
const address = { formattedAddress: 'Integration test address', city: 'Addis Ababa', subCity: null,
  woreda: null, neighborhood: null, street: null, landmark: null, provider: 'geoapify', placeId: 'test-place' };

test('private listing drafts enforce provider access, snapshot exact location, isolate accounts and survive concurrent retries', async () => {
  // approved+location, no application, pending, rejected, approved without location, second owner.
  const ids = Array.from({ length: 6 }, () => randomUUID());
  const tokens = ids.map(() => sessionToken());
  const origin = 'http://127.0.0.1:3000';
  const input = { requestId: randomUUID(), title: '  ቦሌ test apartment  ', transactionType: 'RENT', propertyType: 'APARTMENT' };
  let server;
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, createGeocoder({ key: () => undefined })));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], path = '/api/listings', data = input,
    requestOrigin = origin, contentType = 'application/json', raw } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType,
        ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  try {
    for (const [i, id] of ids.entries()) {
      await getDatabase().account.create({ data: { id, email: `listing-${id}@example.test`, passwordHash: 'test-only-unusable-hash',
        sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
        ...(i === 1 ? {} : { providerApplication: { create: { providerType: 'OWNER', status: i === 2 ? 'PENDING' : i === 3 ? 'REJECTED' : 'APPROVED' } } }),
        ...(i === 4 ? {} : { location: { create: { ...location, address } } }),
      } });
    }
    await start();
    for (const path of ['/api/listings', `/api/listings/${randomUUID()}`]) {
      assert.equal((await call({ path, token: '' })).status, 401);
      assert.equal((await call({ path, token: sessionToken() })).status, 401);
    }
    assert.equal((await call({ method: 'POST', token: '' })).status, 401);
    const empty = await call();
    assert.equal(empty.status, 200); assert.deepEqual(empty.body, { listings: [] });
    assert.equal(empty.headers.get('cache-control'), 'no-store');
    for (const requestOrigin of ['', 'https://attacker.example']) assert.equal((await call({ method: 'POST', requestOrigin })).status, 403);
    assert.equal((await call({ method: 'POST', contentType: 'text/plain' })).status, 415);
    assert.equal((await call({ method: 'POST', raw: '{broken' })).status, 400);
    assert.equal((await call({ method: 'POST', raw: 'x'.repeat(5000) })).status, 413);
    assert.equal((await call({ method: 'PUT' })).status, 405);
    for (const data of [null, [], {}, { ...input, accountId: ids[5] }, { ...input, status: 'PUBLISHED' },
      { ...input, location }, { ...input, address }, { ...input, latitude: 8.99 }, { ...input, title: ' ' },
      { ...input, requestId: 'invalid' }, { ...input, transactionType: 'LEASE' }, { ...input, propertyType: 'CASTLE' }]) {
      assert.equal((await call({ method: 'POST', data })).status, 400);
    }
    for (const i of [1, 2, 3]) {
      assert.equal((await call({ method: 'POST', token: tokens[i] })).status, 403);
      assert.deepEqual((await call({ token: tokens[i] })).body, { listings: [] });
    }
    assert.equal((await call({ method: 'POST', token: tokens[4] })).status, 409);
    assert.deepEqual((await call()).body, { listings: [] });

    const competing = await Promise.all(Array.from({ length: 4 }, () => call({ method: 'POST' })));
    assert.equal(competing.filter(result => result.status === 201).length, 1);
    assert.equal(competing.filter(result => result.status === 200).length, 3);
    const saved = competing[0].body.listing;
    for (const result of competing) assert.deepEqual(result.body.listing, saved);
    assert.equal(saved.title, input.title.trim());
    assert.equal(saved.status, 'DRAFT');
    assert.equal(saved.transactionType, 'RENT'); assert.equal(saved.propertyType, 'APARTMENT');
    assert.ok(Number.isFinite(Date.parse(saved.createdAt)));
    for (const [key, value] of Object.entries(location)) if (key !== 'confirmed') assert.deepEqual(saved.location[key], value);
    assert.deepEqual(saved.location.address, address);
    const path = `/api/listings/${saved.id}`;
    assert.deepEqual((await call({ path })).body, { listing: saved });
    assert.deepEqual((await call()).body, { listings: [saved] });
    assert.equal((await call({ path, token: tokens[5] })).status, 404);
    assert.equal((await call({ path: `/api/listings/${randomUUID()}` })).status, 404);
    assert.equal((await call({ path, method: 'PATCH' })).status, 405);
    assert.deepEqual((await call({ token: tokens[5] })).body, { listings: [] });
    assert.equal((await call({ method: 'POST', data: { ...input, title: 'Different property' } })).status, 409);

    // A subsequent account location change must not rewrite a draft or an idempotent retry.
    await getDatabase().accountLocation.update({ where: { accountId: ids[0] }, data: {
      latitude: 9.04, longitude: 38.75, subcityId: 'arada', address: { ...address, formattedAddress: 'Changed test address' },
    } });
    const retry = await call({ method: 'POST' });
    assert.equal(retry.status, 200); assert.deepEqual(retry.body.listing, saved);
    assert.deepEqual((await call({ path })).body.listing, saved);
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call({ path })).body.listing, saved);
    assert.deepEqual((await call()).body, { listings: [saved] });

    // Idempotency keys are account-scoped, never globally shared across owners.
    const other = await call({ method: 'POST', token: tokens[5] });
    assert.equal(other.status, 201); assert.notEqual(other.body.listing.id, saved.id);
    assert.equal((await call({ path: `/api/listings/${other.body.listing.id}` })).status, 404);
    assert.equal((await call({ token: tokens[5] })).body.listings.length, 1);
    await checkConstraints(getDatabase(), saved.id);
    // Fill the second account to 49, then compete for its final slot.
    await getDatabase().listingDraft.createMany({ data: Array.from({ length: 48 }, () => ({
      id: randomUUID(), accountId: ids[5], requestId: randomUUID(), title: 'Capacity test',
      transactionType: 'RENT', propertyType: 'HOUSE', countryId: location.countryId,
      regionId: location.regionId, cityId: location.cityId, subcityId: location.subcityId,
      latitude: location.latitude, longitude: location.longitude,
      creationPayload: { title: 'Capacity test', transactionType: 'RENT', propertyType: 'HOUSE' },
    })) });
    const capacity = await Promise.all(Array.from({ length: 2 }, () => call({ method: 'POST', token: tokens[5],
      data: { ...input, requestId: randomUUID() } })));
    assert.equal(capacity.filter(result => result.status === 201).length, 1);
    assert.equal(capacity.filter(result => result.status === 409).length, 1);
    assert.equal((await call({ token: tokens[5] })).body.listings.length, 50);
    assert.equal(await getDatabase().listingDraft.count({ where: { accountId: ids[5] } }), 50);
    assert.equal((await call({ method: 'POST', token: tokens[5] })).status, 200);
    // Existing private drafts remain readable if provider access changes; new writes are blocked.
    await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status: 'REJECTED' } });
    assert.deepEqual((await call({ path })).body.listing, saved);
    assert.equal((await call({ method: 'POST' })).status, 200);
    assert.equal((await call({ method: 'POST', data: { ...input, requestId: randomUUID() } })).status, 403);
    await getDatabase().session.update({ where: { tokenHash: digest(tokens[0]) }, data: { expiresAt: new Date(0) } });
    assert.equal((await call({ path })).status, 401);
    assert.equal((await call()).status, 401);
  } finally {
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    assert.equal(await getDatabase().listingDraft.count({ where: { accountId: { in: ids } } }), 0);
    await disconnectDatabase();
  }
});

async function checkConstraints(db, id) {
  async function rejects(operation, expected) {
    const rollback = new Error('Listing constraint accepted invalid data');
    await assert.rejects(db.$transaction(async tx => { await operation(tx); throw rollback; }), error => {
      assert.notEqual(error, rollback);
      assert.equal(error.code, 'P2010');
      assert.equal(error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode, expected);
      return true;
    });
  }
  for (const change of [Prisma.sql`title = ' '`, Prisma.sql`status = 'LIVE'`, Prisma.sql`"transactionType" = 'NONE'`,
    Prisma.sql`"propertyType" = 'CASTLE'`, Prisma.sql`"countryId" = 'KE'`, Prisma.sql`"subcityId" = 'unknown'`,
    Prisma.sql`latitude = 0`, Prisma.sql`longitude = 0`, Prisma.sql`latitude = 'NaN'::double precision`,
    Prisma.sql`longitude = 'Infinity'::double precision`, Prisma.sql`address = '[]'::jsonb`]) {
    await rejects(tx => tx.$executeRaw`UPDATE akgebeya_foundation.listing_draft SET ${change} WHERE id = ${id}::uuid`, '23514');
  }
  await rejects(tx => tx.$executeRaw`UPDATE akgebeya_foundation.listing_draft SET latitude = NULL WHERE id = ${id}::uuid`, '23502');
  await rejects(tx => tx.$executeRaw`UPDATE akgebeya_foundation.listing_draft SET "accountId" = ${randomUUID()}::uuid WHERE id = ${id}::uuid`, '23503');
  await rejects(tx => tx.$executeRaw`
    INSERT INTO akgebeya_foundation.listing_draft
      (id, "accountId", "requestId", title, "transactionType", "propertyType", "countryId", "regionId", "cityId", "subcityId", latitude, longitude, "creationPayload")
    SELECT ${randomUUID()}::uuid, "accountId", "requestId", title, "transactionType", "propertyType", "countryId", "regionId", "cityId", "subcityId", latitude, longitude, "creationPayload"
    FROM akgebeya_foundation.listing_draft WHERE id = ${id}::uuid`, '23505');
}
