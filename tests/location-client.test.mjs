import assert from 'node:assert/strict';
import test from 'node:test';
import { currentPosition, validPlace } from '../apps/web/src/location-client.ts';

test('device location requests a fresh high-accuracy fix and reports its accuracy', async () => {
  const coords = { latitude: 8.995, longitude: 38.785, accuracy: 12.5 };
  const result = await currentPosition({ getCurrentPosition(success, _error, options) {
    assert.deepEqual(options, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
    success({ coords });
  } });
  assert.deepEqual(result, coords);
});

test('device position reports permission, availability, timeout and invalid-fix failures', async () => {
  for (const [code, expected] of [[1, /permission was denied/], [2, /unavailable/], [3, /timed out/]]) {
    await assert.rejects(currentPosition({ getCurrentPosition(_success, error) { error({ code }); } }), expected);
  }
  await assert.rejects(currentPosition(undefined), /unavailable/);
  for (const change of [{ latitude: NaN }, { longitude: Infinity }, { latitude: 91 },
    { longitude: -181 }, { accuracy: -1 }, { accuracy: NaN }]) {
    await assert.rejects(currentPosition({ getCurrentPosition(success) {
      success({ coords: { latitude: 8.995, longitude: 38.785, accuracy: 10, ...change } });
    } }), /invalid location/);
  }
});

test('search result guard rejects malformed coordinates and address providers', () => {
  const place = { latitude: 8.995, longitude: 38.785,
    address: { formattedAddress: 'Bole, Addis Ababa', provider: 'geoapify' } };
  assert.equal(validPlace(place), true);
  for (const value of [null, [], {}, { ...place, latitude: '8.995' }, { ...place, longitude: NaN },
    { ...place, latitude: 91 }, { ...place, address: null }, { ...place, address: { provider: 'geoapify' } },
    { ...place, address: { ...place.address, provider: 'unknown' } },
    { ...place, address: { ...place.address, formattedAddress: 'x'.repeat(1001) } }]) assert.equal(validPlace(value), false);
});

test('device location falls back once after timeout/unavailability but never after denial', async () => {
  for (const code of [2, 3]) {
    const calls = []; let notified = 0;
    const coords = { latitude: 8.995, longitude: 38.785, accuracy: 450 };
    const result = await currentPosition({ getCurrentPosition(success, failure, options) {
      calls.push(options);
      if (calls.length === 1) failure({ code }); else success({ coords });
    } }, { onFallback: () => { notified++; } });
    assert.deepEqual(result, coords);
    assert.deepEqual(calls, [{ enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
      { enableHighAccuracy: false, maximumAge: 0, timeout: 15000 }]);
    assert.equal(notified, 1);
  }
  let requests = 0;
  await assert.rejects(currentPosition({ getCurrentPosition(_success, error) { requests++; error({ code: 1 }); } }), /permission was denied/);
  assert.equal(requests, 1);
});

test('canceled device lookup ignores late callbacks and does not start a fallback', async () => {
  const controller = new globalThis.AbortController();
  let lateSuccess, lateError, requests = 0;
  const pending = currentPosition({ getCurrentPosition(success, error) {
    requests++; lateSuccess = success; lateError = error;
  } }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /canceled/);
  lateError({ code: 3 });
  lateSuccess({ coords: { latitude: 9, longitude: 38, accuracy: 5 } });
  assert.equal(requests, 1);
});
