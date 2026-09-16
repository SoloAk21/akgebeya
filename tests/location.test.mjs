import assert from 'node:assert/strict';
import test from 'node:test';
import { locationInput } from '../apps/api/src/location.ts';

const valid = { countryId: 'ET', regionId: 'addis-ababa', cityId: 'addis-ababa-city',
  subcityId: 'bole', latitude: 8.9806, longitude: 38.7578, confirmed: true };

test('location validates the complete hierarchy and explicit confirmation without coercion', () => {
  assert.deepEqual(locationInput(valid), valid);
  for (const subcityId of ['addis-ketema', 'akaki-kality', 'arada', 'bole', 'gulele', 'kirkos',
    'kolfe-keranio', 'lideta', 'nifas-silk-lafto', 'yeka', 'lemi-kura']) {
    assert.equal(locationInput({ ...valid, subcityId }).subcityId, subcityId);
  }
  for (const change of [{ countryId: 'KE' }, { countryId: 'et' }, { regionId: 'oromia' },
    { cityId: 'dire-dawa' }, { subcityId: 'unknown' }, { subcityId: 'Bole' },
    { confirmed: false }, { confirmed: 'true' }, { confirmed: 1 }, { accountId: 'other' },
    { updatedAt: '2026-01-01' }, { geometry: 'POINT(38.7578 8.9806)' }]) {
    assert.throws(() => locationInput({ ...valid, ...change }), error => error.status === 400);
  }
  for (const field of Object.keys(valid)) {
    const missing = { ...valid }; delete missing[field];
    assert.throws(() => locationInput(missing), error => error.status === 400);
  }
  for (const value of [null, [], {}, 'Addis Ababa']) {
    assert.throws(() => locationInput(value), error => error.status === 400);
  }
});

test('location accepts service area edges and rejects swapped, nonfinite or coerced coordinates', () => {
  assert.deepEqual(locationInput({ ...valid, latitude: 8.98061234, longitude: 38.75781234 }),
    { ...valid, latitude: 8.980612, longitude: 38.757812 });
  for (const latitude of [8.8, 9.15]) for (const longitude of [38.6, 39]) {
    assert.deepEqual(locationInput({ ...valid, latitude, longitude }), { ...valid, latitude, longitude });
  }
  for (const field of ['latitude', 'longitude']) for (const value of [null, '', '8.98', true, NaN, Infinity, -Infinity]) {
    assert.throws(() => locationInput({ ...valid, [field]: value }), error => error.status === 400);
  }
  for (const change of [{ latitude: 8.799999 }, { latitude: 9.150001 }, { latitude: 9.15000001 },
    { longitude: 38.599999 }, { longitude: 38.59999999 }, { longitude: 39.000001 },
    { latitude: 38.7578, longitude: 8.9806 }]) {
    assert.throws(() => locationInput({ ...valid, ...change }), error => error.status === 400);
  }
});
