import assert from 'node:assert/strict';
import { URL } from 'node:url';
import test from 'node:test';
import { createGeocoder as createAdapter, createProviderLimiter, normalizeAddress, reverseInput, searchInput } from '../apps/api/src/geocoding.ts';

const createGeocoder = options => createAdapter({ limiter: () => () => {}, ...options });

const properties = { country_code: 'et', lat: 8.995, lon: 38.785, formatted: 'Bole, Addis Ababa, Ethiopia',
  city: 'Addis Ababa', suburb: 'Bole', district: 'Woreda 03', neighbourhood: 'Atlas',
  street: 'Africa Avenue', name: 'Sample landmark', place_id: 'sample-place' };
const payload = (...items) => ({ results: items });
const response = (data, status = 200) => new globalThis.Response(JSON.stringify(data), { status, headers: { 'retry-after': '45' } });

test('geocoding validates Unicode queries, strict input and supported coordinates', () => {
  assert.equal(searchInput({ query: '  ቦሌ  ', language: 'am' }).query, 'ቦሌ');
  assert.equal(searchInput({ query: 'Bole', language: 'en', proximity: { latitude: 8.995, longitude: 38.785 } }).proximity.longitude, 38.785);
  for (const value of [null, [], {}, { query: '', language: 'en' }, { query: 'Bole', language: 'fr' },
    { query: 'Bole', language: ['en'] }, { query: 'Bole', language: 'en', apiKey: 'client-key' }, { query: 'Bole\nAddis', language: 'en' },
    { query: 'Bole', language: 'en', proximity: { latitude: '9', longitude: 38.78 } },
    { query: 'Bole', language: 'en', proximity: { latitude: 9, longitude: 38.78, extra: true } }]) {
    assert.throws(() => searchInput(value), error => error.status === 400);
  }
  assert.deepEqual(reverseInput({ latitude: 8.995, longitude: 38.785, language: 'am' }),
    { latitude: 8.995, longitude: 38.785, language: 'am' });
  for (const extra of [{ latitude: NaN }, { longitude: Infinity }, { latitude: null },
    { latitude: 38.785, longitude: 8.995 }, { language: 'fr' }, { language: ['en'] }, { address: properties }]) {
    assert.throws(() => reverseInput({ latitude: 8.995, longitude: 38.785, language: 'en', ...extra }), error => error.status === 400);
  }
});

test('address normalization preserves unknown fields as null instead of inventing them', () => {
  const minimal = normalizeAddress({ country_code: 'et', formatted: 'Addis Ababa, Ethiopia' });
  assert.equal(minimal.formattedAddress, 'Addis Ababa, Ethiopia');
  assert.equal(minimal.provider, 'geoapify');
  for (const field of ['city', 'subCity', 'woreda', 'neighborhood', 'street', 'landmark', 'placeId']) assert.equal(minimal[field], null);
  const full = normalizeAddress(properties);
  assert.equal(full.city, 'Addis Ababa');
  assert.equal(full.placeId, 'sample-place');
  assert.equal(full.street, 'Africa Avenue');
  assert.equal(full.landmark, 'Sample landmark');
  assert.equal(full.woreda, null);
  assert.equal(normalizeAddress({ ...properties, country_code: 'ke' }), null);
  assert.equal(normalizeAddress({ ...properties, country_code: ['et'] }), null);
  assert.equal(normalizeAddress({ country_code: 'et' }), null);
});

test('provider adapter filters Ethiopia, constructs server-only requests, caches, and retains reverse point', async () => {
  const requests = [];
  const geocoder = createGeocoder({ key: () => 'test-key-never-return', fetch: async (url, options) => {
    requests.push({ url: new URL(url), options });
    return response(payload(properties, { ...properties, country_code: 'ke', place_id: 'foreign' },
      { ...properties, lon: 0, lat: 0, place_id: 'outside' }));
  } });
  const query = searchInput({ query: 'ቦሌ', language: 'am', proximity: { latitude: 8.995, longitude: 38.785 } });
  const results = await geocoder.search(query);
  assert.equal(results.length, 1);
  assert.equal(results[0].latitude, 8.995);
  assert.equal(results[0].longitude, 38.785);
  assert.ok(!JSON.stringify(results).includes('test-key-never-return'));
  assert.equal(requests[0].url.protocol, 'https:');
  assert.equal(requests[0].url.hostname, 'api.geoapify.com');
  assert.equal(requests[0].url.searchParams.get('apiKey'), 'test-key-never-return');
  assert.equal(requests[0].url.searchParams.get('text'), 'ቦሌ');
  assert.equal(requests[0].url.searchParams.get('lang'), 'am');
  assert.match(requests[0].url.searchParams.get('filter'), /countrycode:et/);
  assert.ok(requests[0].options.signal);
  assert.deepEqual(await geocoder.search(query), results);
  assert.equal(requests.length, 1);
  const reverse = await geocoder.reverse({ latitude: 8.999999, longitude: 38.789999, language: 'en' });
  assert.equal(reverse.latitude, 8.999999);
  assert.equal(reverse.longitude, 38.789999);
  assert.equal(reverse.address.formattedAddress, properties.formatted);
  assert.equal(requests[1].url.searchParams.get('lat'), '8.999999');
  assert.equal(requests[1].url.searchParams.get('lon'), '38.789999');
});

test('empty, unavailable and failed provider responses expose no provider details or key', async () => {
  const empty = createGeocoder({ key: () => 'test-key', fetch: async () => response(payload()) });
  assert.deepEqual(await empty.search({ query: 'Missing place', language: 'en' }), []);
  assert.equal(await empty.reverse({ latitude: 8.995, longitude: 38.785, language: 'en' }), null);
  const unconfigured = createGeocoder({ key: () => undefined, fetch: async () => { assert.fail('Missing key must not request provider'); } });
  await assert.rejects(unconfigured.search({ query: 'Bole', language: 'en' }), error => error.status === 503);
  for (const status of [401, 429, 500]) {
    const failed = createGeocoder({ key: () => 'test-key-secret', fetch: async () => response({ error: 'private provider test-key-secret' }, status) });
    await assert.rejects(failed.search({ query: 'Bole', language: 'en' }), error => {
      assert.ok([429, 502].includes(error.status));
      if (status === 429) assert.equal(error.retryAfter, 45);
      assert.ok(!error.message.includes('test-key-secret'));
      assert.ok(!error.message.includes('private provider'));
      return true;
    });
  }
  const failed = createGeocoder({ key: () => 'test-key-secret', fetch: async () => { throw new Error('private URL apiKey=test-key-secret'); } });
  await assert.rejects(failed.search({ query: 'Bole', language: 'en' }), error => error.status === 502 && !error.message.includes('test-key-secret'));
});

test('cache entries are scoped to account and language, and cancellation prevents a lookup', async () => {
  let requests = 0;
  const geocoder = createGeocoder({ key: () => 'test-key', fetch: async () => {
    requests++; return response(payload(properties));
  } });
  const input = { query: 'Bole', language: 'en' };
  await geocoder.search(input, undefined, 'first-account');
  await geocoder.search(input, undefined, 'first-account');
  assert.equal(requests, 1);
  await geocoder.search(input, undefined, 'second-account');
  await geocoder.search({ ...input, language: 'am' }, undefined, 'first-account');
  assert.equal(requests, 3);
  const controller = new globalThis.AbortController();
  controller.abort();
  await assert.rejects(geocoder.search(input, controller.signal, 'third-account'));
  assert.equal(requests, 3);
  const malformed = createGeocoder({ key: () => 'test-key', fetch: async () => response({ private: 'provider detail' }) });
  await assert.rejects(malformed.search(input), error => error.status === 502 && !error.message.includes('provider detail'));
  const timeout = createGeocoder({ key: () => 'test-key', fetch: async () => { throw new globalThis.DOMException('Provider timeout', 'TimeoutError'); } });
  await assert.rejects(timeout.search(input), error => error.status === 502);
});

test('provider limiter bounds concurrent and rolling requests without relying on wall-clock sleeps', () => {
  let now = 10000;
  const acquire = createProviderLimiter(() => now);
  const releases = Array.from({ length: 4 }, () => acquire());
  assert.throws(() => acquire(), error => error.status === 429);
  releases[0]();
  const fifth = acquire();
  for (const release of releases.slice(1)) release();
  fifth();
  assert.throws(() => acquire(), error => error.status === 429);
  now += 1001;
  acquire()();
});

test('provider cache expires and oversized responses fail safely', async () => {
  let now = 1000;
  let count = 0;
  const cached = createGeocoder({ key: () => 'test-key', now: () => now, fetch: async () => {
    count++; return response(payload(properties));
  } });
  const input = { query: 'Bole', language: 'en' };
  await cached.search(input); await cached.search(input);
  assert.equal(count, 1);
  now += 300001;
  await cached.search(input);
  assert.equal(count, 2);
  const oversized = createGeocoder({ key: () => 'test-key', fetch: async () => response({ results: [], excess: 'x'.repeat(1048577) }) });
  await assert.rejects(oversized.search(input), error => error.status === 502);
});
