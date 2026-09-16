import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest, sessionToken } from '../../apps/api/src/auth-security.ts';
import { createGeocoder } from '../../apps/api/src/geocoding.ts';

test('authenticated geocoding stores only server-resolved addresses aligned to saved points', async () => {
  const ids = [randomUUID(), randomUUID()];
  const tokens = [sessionToken(), sessionToken()];
  const firstWindow = Math.floor(Date.now() / 60000);
  const origin = 'http://127.0.0.1:3000';
  const key = 'test-provider-key-never-public';
  const location = { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city',
    subcityId: 'bole', latitude: 8.995, longitude: 38.785, confirmed: true };
  let providerFailed = false;
  let requests = 0;
  const provider = createGeocoder({ key: () => key, limiter: () => () => {}, fetch: async url => {
    requests++;
    if (providerFailed) throw new Error(`Provider private URL apiKey=${key}`);
    return new globalThis.Response(JSON.stringify({ results: [{ country_code: 'et',
      lat: 8.9901, lon: 38.7801, formatted: new globalThis.URL(url).searchParams.get('lang') === 'am'
        ? 'ቦሌ፣ አዲስ አበባ፣ ኢትዮጵያ' : 'Sample place, Bole, Addis Ababa, Ethiopia',
      city: 'Addis Ababa', district: 'Bole', street: 'Sample street', name: 'Sample place', place_id: 'provider-fixture' }] }));
  } });
  let server;
  async function start() {
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }, provider));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
  }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  async function call({ path = '/api/location-search', method = 'POST', token = tokens[0],
    data = { query: 'Bole', language: 'en' }, requestOrigin = origin } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Origin: requestOrigin, 'Content-Type': 'application/json',
        ...(token ? { Cookie: `akgebeya_session=${token}` } : {}) },
      ...(method === 'GET' ? {} : { body: JSON.stringify(data) }),
    });
    const body = await response.json();
    assert.ok(!JSON.stringify(body).includes(key));
    assert.ok(!JSON.stringify(body).includes('Provider private'));
    return { status: response.status, headers: response.headers, body };
  }
  try {
    for (const [i, id] of ids.entries()) await getDatabase().account.create({ data: {
      id, email: `geocoding-${id}@example.test`, passwordHash: 'geocoding-test-unusable-hash',
      sessions: { create: { tokenHash: digest(tokens[i]), expiresAt: new Date(Date.now() + 600000) } },
    } });
    await start();
    for (const path of ['/api/location-search', '/api/location-reverse']) {
      assert.equal((await call({ path, token: '' })).status, 401);
      assert.equal((await call({ path, requestOrigin: 'https://attacker.example' })).status, 403);
      assert.equal((await call({ path, method: 'GET' })).status, 405);
      assert.equal((await call({ path, data: { apiKey: key } })).status, 400);
    }
    assert.equal(requests, 0);
    const search = await call();
    assert.equal(search.status, 200);
    assert.equal(search.headers.get('cache-control'), 'no-store');
    assert.equal(search.body.results.length, 1);
    assert.equal(search.body.results[0].address.city, 'Addis Ababa');
    const reverse = await call({ path: '/api/location-reverse', data: { latitude: 8.995, longitude: 38.785, language: 'am' } });
    assert.equal(reverse.status, 200);
    assert.equal(reverse.body.result.latitude, 8.995);
    assert.equal(reverse.body.result.longitude, 38.785);
    assert.equal(reverse.body.result.address.woreda, null);
    assert.equal((await call({ path: '/api/location', method: 'PUT', data: { ...location, address: reverse.body.result.address } })).status, 400);
    const saved = await call({ path: '/api/location', method: 'PUT', data: location });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.location.address.provider, 'geoapify');
    assert.equal(saved.body.location.latitude, 8.995);
    assert.equal(saved.body.location.longitude, 38.785);
    assert.equal(saved.body.location.address.placeId, 'provider-fixture');
    const [row] = await getDatabase().$queryRaw`
      SELECT latitude, longitude, address FROM akgebeya_foundation.account_location WHERE "accountId" = ${ids[0]}::uuid`;
    assert.deepEqual(row, { latitude: 8.995, longitude: 38.785, address: saved.body.location.address });
    assert.deepEqual((await call({ path: '/api/location', method: 'PUT', data: location })).body.location, saved.body.location);
    const amharic = await call({ path: '/api/location', method: 'PUT', data: { ...location, addressLanguage: 'am' } });
    assert.equal(amharic.status, 200);
    assert.equal(amharic.body.location.address.formattedAddress, 'ቦሌ፣ አዲስ አበባ፣ ኢትዮጵያ');
    assert.equal(amharic.body.location.updatedAt, saved.body.location.updatedAt);
    assert.equal(Object.hasOwn(amharic.body.location, 'addressLanguage'), false);
    assert.deepEqual((await call({ path: '/api/location', method: 'GET' })).body.location, amharic.body.location);
    assert.equal((await call({ path: '/api/location', method: 'PUT', data: { ...location, addressLanguage: ['am'] } })).status, 400);
    assert.equal((await call({ path: '/api/location', method: 'GET', token: tokens[1] })).body.location, null);
    providerFailed = true;
    const failedLookup = await call({ data: { query: 'Uncached place', language: 'en' } });
    assert.equal(failedLookup.status, 502);
    const moved = await call({ path: '/api/location', method: 'PUT', data: { ...location, latitude: 9.001, longitude: 38.79 } });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.location.address, null);
    assert.equal(moved.body.location.latitude, 9.001);
    await stop(); await disconnectDatabase(); await start();
    assert.deepEqual((await call({ path: '/api/location', method: 'GET' })).body.location, moved.body.location);
    providerFailed = false;
    // Seed only this fixture account's quota; unrelated accounts retain their own budget.
    const window = Math.floor(Date.now() / 60000);
    const quotaKey = digest(`geocoding:${ids[0]}:${window}`);
    await getDatabase().authAttempt.upsert({ where: { key: quotaKey },
      create: { key: quotaKey, count: 30, expiresAt: new Date((window + 1) * 60000) }, update: { count: 30 } });
    const limited = await call();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await call({ token: tokens[1] })).status, 200);
    await getDatabase().session.update({ where: { tokenHash: digest(tokens[1]) }, data: { expiresAt: new Date(0) } });
    assert.equal((await call({ token: tokens[1] })).status, 401);
  } finally {
    if (server?.listening) await stop();
    const keys = [];
    for (let window = firstWindow; window <= Math.floor(Date.now() / 60000); window++) {
      for (const id of ids) keys.push(digest(`geocoding:${id}:${window}`));
    }
    await getDatabase().authAttempt.deleteMany({ where: { key: { in: keys } } });
    await getDatabase().account.deleteMany({ where: { id: { in: ids } } });
    await disconnectDatabase();
  }
});
