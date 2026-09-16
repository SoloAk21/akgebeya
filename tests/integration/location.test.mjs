import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';
import { Prisma } from '../../apps/api/src/generated/prisma/client.ts';
import { createGeocoder } from '../../apps/api/src/geocoding.ts';

const input = { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city',
  subcityId: 'bole', latitude: 8.9806, longitude: 38.7578, confirmed: true };

test('location persists one confirmed PostGIS point per account with validation, isolation and atomic retries', async () => {
  const ids = [randomUUID(), randomUUID()];
  const tokens = [sessionToken(), sessionToken()];
  const origin = 'http://127.0.0.1:3000';
  let server;
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, createGeocoder({ key: () => undefined })));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ method = 'GET', token = tokens[0], data = input, requestOrigin = origin,
    raw, contentType = 'application/json', path = '/api/location' } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': contentType,
        ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(data) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  try {
    for (const [i, id] of ids.entries()) await getDatabase().account.create({ data: {
      id, email: `location-${id}@example.test`, passwordHash: 'location-test-only-unusable-hash',
      sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
    } });
    await start();
    for (const path of ['/api/location', '/api/location-options']) {
      assert.equal((await call({ path, token: '' })).status, 401);
      assert.equal((await call({ path, token: sessionToken() })).status, 401);
    }
    assert.equal((await call({ method: 'PUT', token: '' })).status, 401);
    const initial = await call();
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body, { location: null });
    assert.equal(initial.headers.get('cache-control'), 'no-store');
    const options = await call({ path: '/api/location-options' });
    assert.equal(options.status, 200);
    assert.equal(options.headers.get('cache-control'), 'no-store');
    assert.equal(options.body.country.id, 'ET');
    assert.equal(options.body.region.id, 'addis-ababa');
    assert.equal(options.body.city.id, 'addis-ababa-city');
    assert.deepEqual(options.body.subcities.map(row => row.id).sort(), ['addis-ketema', 'akaki-kality',
      'arada', 'bole', 'gulele', 'kirkos', 'kolfe-keranio', 'lideta', 'nifas-silk-lafto', 'yeka', 'lemi-kura'].sort());
    assert.deepEqual(options.body.bounds, { south: 8.8, north: 9.15, west: 38.6, east: 39 });
    assert.equal((await call({ path: '/api/location-options', method: 'PUT' })).status, 405);
    const wrongMethod = await call({ method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET, PUT');
    for (const requestOrigin of ['', 'https://attacker.example']) {
      assert.equal((await call({ method: 'PUT', requestOrigin })).status, 403);
    }
    assert.equal((await call({ method: 'PUT', contentType: 'text/plain' })).status, 415);
    assert.equal((await call({ method: 'PUT', raw: '{invalid' })).status, 400);
    assert.equal((await call({ method: 'PUT', raw: 'x'.repeat(5000) })).status, 413);
    for (const data of [{}, null, [], { ...input, accountId: ids[1] }, { ...input, confirmed: false },
      { ...input, countryId: 'KE' }, { ...input, regionId: 'oromia' }, { ...input, cityId: 'dire-dawa' },
      { ...input, subcityId: 'unknown' }, { ...input, latitude: '8.98' }, { ...input, longitude: null },
      { ...input, latitude: 38.7578, longitude: 8.9806 }, { ...input, latitude: 9.150001 },
      { ...input, longitude: 38.599999 }, { ...input, updatedAt: '2020-01-01' }]) {
      assert.equal((await call({ method: 'PUT', data })).status, 400);
    }
    // JSON numbers can overflow even though the input is syntactically valid JSON.
    assert.equal((await call({ method: 'PUT', raw: JSON.stringify(input).replace('8.9806', '1e400') })).status, 400);
    assert.deepEqual((await call()).body, { location: null });
    const competing = await Promise.all(Array.from({ length: 4 }, () => call({ method: 'PUT' })));
    for (const result of competing) assert.equal(result.status, 200);
    const saved = competing[0].body.location;
    assert.deepEqual(Object.keys(saved).sort(), [...Object.keys(input), 'updatedAt', 'address'].sort());
    assert.deepEqual(saved, { ...input, updatedAt: saved.updatedAt, address: null });
    assert.ok(Number.isFinite(Date.parse(saved.updatedAt)));
    for (const result of competing) assert.deepEqual(result.body.location, saved);
    assert.deepEqual((await call({ method: 'PUT' })).body.location, saved);
    assert.equal((await call({ token: tokens[1] })).body.location, null);
    assert.equal((await call({ path: `/api/location/${ids[0]}`, token: tokens[1] })).status, 404);
    const alternatives = [{ ...input, subcityId: 'arada', latitude: 9.04, longitude: 38.75 },
      { ...input, subcityId: 'kirkos', latitude: 9.01, longitude: 38.76 }];
    const race = await Promise.all(alternatives.map(data => call({ method: 'PUT', data })));
    for (const result of race) assert.equal(result.status, 200);
    const winner = (await call()).body.location;
    assert.ok(race.some(result => JSON.stringify(result.body.location) === JSON.stringify(winner)));
    assert.ok(alternatives.some(data => Object.entries(data).every(([key, value]) => winner[key] === value)));
    assert.notEqual(winner.updatedAt, saved.updatedAt);
    assert.deepEqual((await call({ method: 'PUT', data: { ...winner, updatedAt: undefined, address: undefined } })).body.location, winner);
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call()).body.location, winner);
    // The storage assertions below also verify longitude/latitude ordering and database constraints.
    await checkStorage(getDatabase(), ids, winner);
    await getDatabase().session.update({ where: { tokenHash: digest(tokens[0]) }, data: { expiresAt: new Date(0) } });
    for (const path of ['/api/location', '/api/location-options']) assert.equal((await call({ path })).status, 401);
    assert.equal((await call({ method: 'PUT' })).status, 401);
    await getDatabase().session.delete({ where: { tokenHash: digest(tokens[1]) } });
    assert.equal((await call({ token: tokens[1], method: 'PUT' })).status, 401);
  } finally {
    if (server?.listening) await stop();
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    await checkCascade(getDatabase(), ids);
    await disconnectDatabase();
  }
});

async function checkStorage(db, ids, winner) {
  const [extension] = await db.$queryRaw`
    SELECT n.nspname AS schema FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'postgis'`;
  assert.ok(extension);
  const namespace = Prisma.raw(`"${extension.schema.replaceAll('"', '""')}"`);
  const rows = await db.$queryRaw`
    SELECT "accountId", latitude, longitude, ${namespace}.ST_SRID(point) AS srid,
      ${namespace}.ST_X(point) AS x, ${namespace}.ST_Y(point) AS y,
      ${namespace}.ST_IsValid(point) AS valid
    FROM akgebeya_foundation.account_location
    WHERE "accountId" IN (${ids[0]}::uuid, ${ids[1]}::uuid)`;
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { accountId: ids[0], latitude: winner.latitude, longitude: winner.longitude,
    srid: 4326, x: winner.longitude, y: winner.latitude, valid: true });
  async function constraint(operation, expected) {
    const rollback = new Error('Location constraint accepted invalid data');
    await assert.rejects(db.$transaction(async tx => { await operation(tx); throw rollback; }), error => {
      assert.notEqual(error, rollback);
      assert.equal(error.code, 'P2010');
      assert.equal(error.meta?.code ?? error.meta?.driverAdapterError?.cause?.originalCode, expected);
      return true;
    });
  }
  for (const change of [Prisma.sql`latitude = 9.150001`, Prisma.sql`longitude = 38.599999`,
    Prisma.sql`latitude = 'NaN'::double precision`, Prisma.sql`longitude = 'Infinity'::double precision`,
    Prisma.sql`confirmed = false`, Prisma.sql`"countryId" = 'KE'`, Prisma.sql`"regionId" = 'oromia'`,
    Prisma.sql`"cityId" = 'dire-dawa'`, Prisma.sql`"subcityId" = 'unknown'`]) {
    await constraint(tx => tx.$executeRaw`UPDATE akgebeya_foundation.account_location SET ${change} WHERE "accountId" = ${ids[0]}::uuid`, '23514');
  }
  await constraint(tx => tx.$executeRaw`UPDATE akgebeya_foundation.account_location SET latitude = NULL WHERE "accountId" = ${ids[0]}::uuid`, '23502');
  await constraint(tx => tx.$executeRaw`UPDATE akgebeya_foundation.account_location SET point = ${namespace}.ST_SetSRID(${namespace}.ST_MakePoint(0, 0), 4326) WHERE "accountId" = ${ids[0]}::uuid`, '428C9');
  for (const [accountId, state] of [[ids[0], '23505'], [randomUUID(), '23503']]) {
    await constraint(tx => tx.$executeRaw`
      INSERT INTO akgebeya_foundation.account_location
        ("accountId", "countryId", "regionId", "cityId", "subcityId", latitude, longitude, confirmed)
      SELECT ${accountId}::uuid, "countryId", "regionId", "cityId", "subcityId", latitude, longitude, confirmed
      FROM akgebeya_foundation.account_location WHERE "accountId" = ${ids[0]}::uuid`, state);
  }
  const [unchanged] = await db.$queryRaw`
    SELECT latitude, longitude, "subcityId", "updatedAt" FROM akgebeya_foundation.account_location WHERE "accountId" = ${ids[0]}::uuid`;
  assert.deepEqual(unchanged, { latitude: winner.latitude, longitude: winner.longitude,
    subcityId: winner.subcityId, updatedAt: new Date(winner.updatedAt) });
}

async function checkCascade(db, ids) {
  const [row] = await db.$queryRaw`
    SELECT count(*)::integer AS count FROM akgebeya_foundation.account_location
    WHERE "accountId" IN (${ids[0]}::uuid, ${ids[1]}::uuid)`;
  assert.equal(row.count, 0);
}
