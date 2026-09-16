import assert from 'node:assert/strict';
import test from 'node:test';
import { listingEditInput, missingListingFields } from '../apps/api/src/listing-validation.ts';

const valid = { version: 1, title: 'Bole home', transactionType: 'RENT', propertyType: 'HOUSE',
  description: '', priceEtb: null, areaSqm: null, bedrooms: null, bathrooms: null, complete: false };

test('editing normalizes Unicode and exact decimal strings without floating-point arithmetic', () => {
  const result = listingEditInput({ ...valid, title: ' Cafe\u0301 ', description: '  Cafe\u0301\n\tHome  ', priceEtb: '123.4', areaSqm: '10' });
  assert.equal(result.title, 'Café'); assert.equal(result.description, 'Café\n\tHome');
  assert.equal(listingEditInput({ ...valid, description: 'First line\r\nSecond line' }).description, 'First line\nSecond line');
  assert.equal(result.priceEtb, '123.40'); assert.equal(result.areaSqm, '10.00');
  assert.equal(listingEditInput({ ...valid, priceEtb: '999999999999.99', areaSqm: '999999999.99' }).priceEtb, '999999999999.99');
  assert.equal(listingEditInput({ ...valid, description: '🏡'.repeat(2000) }).description, '🏡'.repeat(2000));
  assert.equal(listingEditInput({ ...valid, bedrooms: 0, bathrooms: 100 }).bedrooms, 0);
});

test('editing rejects forged fields, coercion, invalid precision, controls and inconsistent rooms', () => {
  const bad = [null, [], {}, 'house'];
  for (const field of Object.keys(valid)) { const missing = { ...valid }; delete missing[field]; bad.push(missing); }
  for (const change of [{ version: 0 }, { version: 1.1 }, { version: '1' }, { version: Infinity },
    { title: '' }, { title: '🏡'.repeat(121) }, { title: 'House\nBole' }, { title: 'House\u202e' },
    { description: null }, { description: [] }, { description: 'A\u0000B' }, { description: 'A\rB' },
    { description: 'A\u202eB' }, { description: '🏡'.repeat(2001) },
    { transactionType: 'rent' }, { propertyType: 'VILLA' }, { complete: 'true' },
    { bedrooms: -1 }, { bedrooms: 101 }, { bedrooms: 1.5 }, { bedrooms: '1' },
    { bathrooms: -1 }, { bathrooms: 101 }, { bathrooms: true },
    { propertyType: 'LAND', bedrooms: 0 }, { propertyType: 'LAND', bathrooms: 0 },
    { propertyType: 'COMMERCIAL', bedrooms: 0 }, { status: 'PUBLISHED' }, { accountId: 'other' },
    { location: { latitude: 8.99, longitude: 38.78 } }, { createdAt: '2026-01-01' }]) bad.push({ ...valid, ...change });
  for (const field of ['priceEtb', 'areaSqm']) for (const value of ['', '0', '-1', '+1', '1e2', '1.001', 'NaN', 'Infinity', 12.34, true, []]) {
    bad.push({ ...valid, [field]: value });
  }
  bad.push({ ...valid, priceEtb: '1000000000000' }, { ...valid, areaSqm: '1000000000' });
  for (const value of bad) assert.throws(() => listingEditInput(value), error => error.status === 400);
});

test('completion reports missing fields and respects residential, land and commercial requirements', () => {
  assert.deepEqual([...missingListingFields(valid)].sort(), ['areaSqm', 'bathrooms', 'bedrooms', 'description', 'priceEtb'].sort());
  const ready = { ...valid, description: 'A sufficiently detailed home description.', priceEtb: '5000.00', areaSqm: '70.00', bedrooms: 0, bathrooms: 1 };
  assert.deepEqual(missingListingFields(ready), []);
  assert.ok(missingListingFields({ ...ready, bathrooms: 0 }).includes('bathrooms'));
  assert.deepEqual(missingListingFields({ ...ready, propertyType: 'LAND', bedrooms: null, bathrooms: null }), []);
  assert.deepEqual(missingListingFields({ ...ready, propertyType: 'COMMERCIAL', bedrooms: null, bathrooms: null }), []);
  assert.ok(missingListingFields({ ...ready, description: 'Short' }).includes('description'));
});
