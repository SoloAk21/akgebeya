import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { listingInput } from '../apps/api/src/listing.ts';

const valid = { requestId: randomUUID(), title: 'Bole apartment', transactionType: 'RENT', propertyType: 'APARTMENT' };

test('listing input accepts Unicode titles and the exact supported transaction and property choices', () => {
  assert.deepEqual(listingInput({ ...valid, title: '  ቦሌ ቤት  ' }), { ...valid, title: 'ቦሌ ቤት' });
  assert.equal(listingInput({ ...valid, title: 'Cafe\u0301 house' }).title, 'Café house');
  for (const transactionType of ['RENT', 'SALE']) for (const propertyType of ['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL']) {
    assert.deepEqual(listingInput({ ...valid, transactionType, propertyType }), { ...valid, transactionType, propertyType });
  }
  assert.equal(listingInput({ ...valid, title: '🏡'.repeat(120) }).title, '🏡'.repeat(120));
  assert.equal(listingInput({ ...valid, title: 'A' }).title, 'A');
});

test('listing input rejects missing, coerced, unsupported and forged fields', () => {
  const bad = [null, [], {}, 'house'];
  for (const field of Object.keys(valid)) {
    const missing = { ...valid }; delete missing[field]; bad.push(missing);
  }
  for (const change of [
    { requestId: '' }, { requestId: 'not-a-uuid' }, { requestId: 1 }, { requestId: [valid.requestId] },
    { title: '' }, { title: '   ' }, { title: null }, { title: ['House'] }, { title: 123 },
    { title: '🏡'.repeat(121) }, { title: 'House\nBole' }, { title: 'House\u0000' },
    { title: 'House\u202e' },
    { transactionType: 'rent' }, { transactionType: 'LEASE' }, { transactionType: ['RENT'] },
    { propertyType: 'VILLA' }, { propertyType: 'house' }, { propertyType: null },
    { accountId: randomUUID() }, { status: 'PUBLISHED' }, { latitude: 8.99 },
    { longitude: 38.78 }, { address: { formattedAddress: 'Forged' } },
    { location: { latitude: 8.99, longitude: 38.78 } }, { createdAt: '2026-01-01' },
  ]) bad.push({ ...valid, ...change });
  for (const value of bad) assert.throws(() => listingInput(value), error => error.status === 400);
});
