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

test('listing edits persist private partial and complete records with atomic versions and unchanged location snapshots', async () => {
  const ids = [randomUUID(), randomUUID()]; const tokens = ids.map(() => sessionToken());
  const origin = 'http://127.0.0.1:3000';
  const create = { requestId: randomUUID(), title: 'Initial home', transactionType: 'RENT', propertyType: 'HOUSE' };
  let server; let path = '/api/listings';
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, createGeocoder({ key: () => undefined })));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], requestPath = path, data, requestOrigin = origin,
    contentType = 'application/json', raw } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${requestPath}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType, ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data ?? {}) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  const edit = listing => ({ version: listing.version, title: listing.title, transactionType: listing.transactionType,
    propertyType: listing.propertyType, description: listing.description, priceEtb: listing.priceEtb,
    areaSqm: listing.areaSqm, bedrooms: listing.bedrooms, bathrooms: listing.bathrooms, complete: listing.status === 'COMPLETE' });
  try {
    for (const [i, id] of ids.entries()) await getDatabase().account.create({ data: {
      id, email: `listing-edit-${id}@example.test`, passwordHash: 'test-only-unusable-hash',
      sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
      providerApplication: { create: { providerType: 'OWNER', status: 'APPROVED' } },
      location: { create: { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city', subcityId: 'bole',
        latitude: 8.995123, longitude: 38.785456, confirmed: true } },
    } });
    await start();
    const created = await call({ method: 'POST', data: create }); assert.equal(created.status, 201);
    let saved = created.body.listing; const originalLocation = saved.location;
    path = `/api/listings/${saved.id}`;
    assert.equal(saved.version, 1); assert.equal(saved.description, '');
    assert.equal(saved.priceEtb, null); assert.equal(saved.areaSqm, null);
    assert.ok(saved.missingFields.includes('description'));
    const initial = edit(saved);
    assert.equal((await call({ method: 'PUT', data: initial, token: '' })).status, 401);
    assert.equal((await call({ method: 'PUT', data: initial, token: tokens[1] })).status, 404);
    assert.equal((await call({ method: 'PUT', data: initial, requestPath: `/api/listings/${randomUUID()}` })).status, 404);
    for (const requestOrigin of ['', 'https://attacker.example']) assert.equal((await call({ method: 'PUT', data: initial, requestOrigin })).status, 403);
    assert.equal((await call({ method: 'PUT', data: initial, contentType: 'text/plain' })).status, 415);
    assert.equal((await call({ method: 'PUT', raw: '{broken' })).status, 400);
    assert.equal((await call({ method: 'PUT', raw: 'x'.repeat(17000) })).status, 413);
    for (const change of [{ status: 'PUBLISHED' }, { location: originalLocation }, { priceEtb: 1.23 },
      { areaSqm: '1.001' }, { bedrooms: -1 }, { version: 0 }, { description: 'invalid\u0000' }]) {
      assert.equal((await call({ method: 'PUT', data: { ...initial, ...change } })).status, 400);
    }
    const incomplete = await call({ method: 'PUT', data: { ...initial, complete: true } });
    assert.equal(incomplete.status, 422); assert.ok(incomplete.body.fieldErrors.description);
    assert.deepEqual((await call()).body.listing, saved);
    const noop = await call({ method: 'PUT', data: initial });
    assert.equal(noop.status, 200); assert.deepEqual(noop.body.listing, saved);
    // This legal Unicode body exceeds the old 4KB limit but remains below editing's 16KB bound.
    const partial = await call({ method: 'PUT', data: { ...initial, title: ' Updated home ', description: '🏡'.repeat(2000),
      priceEtb: '999999999999.99', areaSqm: '999999999.99' } });
    assert.equal(partial.status, 200); saved = partial.body.listing;
    assert.equal(saved.version, 2); assert.equal(saved.status, 'DRAFT'); assert.equal(saved.title, 'Updated home');
    assert.equal(saved.priceEtb, '999999999999.99'); assert.equal(saved.areaSqm, '999999999.99');
    assert.deepEqual(saved.location, originalLocation);
    assert.equal((await call({ method: 'PUT', data: initial })).status, 409);
    assert.deepEqual((await call()).body.listing, saved);
    const ready = { ...edit(saved), description: 'A spacious home with a bright living room.', bedrooms: 0, bathrooms: 1, complete: true };
    const race = await Promise.all(['First title', 'Second title'].map(title => call({ method: 'PUT', data: { ...ready, title } })));
    assert.equal(race.filter(result => result.status === 200).length, 1);
    assert.equal(race.filter(result => result.status === 409).length, 1);
    saved = race.find(result => result.status === 200).body.listing;
    assert.equal(saved.version, 3); assert.equal(saved.status, 'COMPLETE'); assert.deepEqual(saved.missingFields, []);
    assert.deepEqual(saved.location, originalLocation);
    assert.deepEqual((await call({ method: 'PUT', data: edit(saved) })).body.listing, saved);
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call()).body.listing, saved);
    assert.deepEqual((await call({ requestPath: '/api/listings' })).body.listings, [saved]);
    const retry = await call({ method: 'POST', requestPath: '/api/listings', data: create });
    assert.equal(retry.status, 200); assert.deepEqual(retry.body.listing, saved);
    assert.equal((await call({ method: 'POST', requestPath: '/api/listings', data: { ...create, title: saved.title } })).status, 409);
    const reopened = await call({ method: 'PUT', data: { ...edit(saved), complete: false, priceEtb: null } });
    assert.equal(reopened.status, 200); saved = reopened.body.listing;
    assert.equal(saved.status, 'DRAFT'); assert.equal(saved.version, 4); assert.ok(saved.missingFields.includes('priceEtb'));
    assert.deepEqual(saved.location, originalLocation);
    await checkConstraints(getDatabase(), saved.id);
    await getDatabase().providerApplication.update({ where: { accountId: ids[0] }, data: { status: 'REJECTED' } });
    assert.equal((await call({ method: 'PUT', data: { ...edit(saved), title: 'Forbidden edit' } })).status, 403);
    assert.deepEqual((await call()).body.listing, saved);
  } finally {
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    assert.equal(await getDatabase().listingDraft.count({ where: { accountId: { in: ids } } }), 0);
    await disconnectDatabase();
  }
});

async function checkConstraints(db, id) {
  for (const change of [Prisma.sql`version = 0`, Prisma.sql`"priceEtb" = 0`, Prisma.sql`"areaSqm" = -1`,
    Prisma.sql`bedrooms = -1`, Prisma.sql`bathrooms = 101`, Prisma.sql`status = 'COMPLETE'`,
    Prisma.sql`"propertyType" = 'LAND', bedrooms = 1`]) {
    const rollback = new Error('Editing constraint accepted invalid data');
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRaw`UPDATE akgebeya_foundation.listing_draft SET ${change} WHERE id = ${id}::uuid`;
      throw rollback;
    }), error => {
      assert.notEqual(error, rollback); assert.equal(error.code, 'P2010');
      assert.equal(error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode, '23514'); return true;
    });
  }
}
