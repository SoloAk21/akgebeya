import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewInput } from '../apps/api/src/admin.ts';

test('admin decisions require exact input and a bounded, meaningful rejection reason', () => {
  assert.deepEqual(reviewInput({ decision: 'APPROVED' }), { decision: 'APPROVED', reason: null });
  assert.deepEqual(reviewInput({ decision: 'REJECTED', reason: '  Please correct your provider type.  ' }),
    { decision: 'REJECTED', reason: 'Please correct your provider type.' });
  assert.equal(reviewInput({ decision: 'REJECTED', reason: 'x'.repeat(500) }).reason.length, 500);
  for (const data of [null, [], {}, { decision: { toString: 'APPROVED' } }, { decision: 'PENDING' },
    { decision: 'REJECTED' }, { decision: 'REJECTED', reason: ' ' }, { decision: 'APPROVED', reason: null },
    { decision: 'APPROVED', reviewerId: 'other' }, { decision: 'APPROVED', reason: 'x'.repeat(501) },
    { decision: 'APPROVED', reason: 'line\nbreak' }]) {
    assert.throws(() => reviewInput(data), error => error.status === 400);
  }
});
