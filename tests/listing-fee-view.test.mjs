import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListingFee, formatListingFee, FeeSourceChangedError } from '../apps/web/src/listing-fee.ts';

const id = '12345678-1234-1234-1234-123456789012';
const fee = { listingId: id, sourceVersion: 3, currency: 'ETB', amount: '1000.00', policyRevision: 'flat-etb-1000-v1', calculatedAt: '2026-09-16T10:00:00.000Z' };
test('fee display uses the returned amount and retains two decimal places', () => {
  assert.equal(formatListingFee(parseListingFee(fee, id, 3)), '1,000.00 ETB');
  assert.equal(formatListingFee(parseListingFee({ ...fee, amount: '1250.50' }, id, 3)), '1,250.50 ETB');
});
test('fee parser rejects stale or unrelated property responses', () => {
  assert.throws(() => parseListingFee(fee, id, 4), FeeSourceChangedError);
  assert.throws(() => parseListingFee({ ...fee, listingId: '22345678-1234-1234-1234-123456789012' }, id, 3));
});
test('fee parser rejects malformed amounts, currencies, metadata and coercible values', () => {
  for (const amount of [1000, '-1.00', '0.00', '1e3', '01.00', '1', '1.0', '1.001', 'NaN', ['1000.00']]) {
    assert.throws(() => parseListingFee({ ...fee, amount }, id, 3));
  }
  for (const change of [{ currency: 'USD' }, { currency: ['ETB'] }, { sourceVersion: '3' }, { calculatedAt: 'invalid' }, { policyRevision: '' }, { policyRevision: ['flat-etb-1000-v1'] }]) {
    assert.throws(() => parseListingFee({ ...fee, ...change }, id, 3));
  }
  for (const value of [null, [], {}, 'fee']) assert.throws(() => parseListingFee(value, id, 3));
});
