import assert from 'node:assert/strict';
import test from 'node:test';
import { profileInput } from '../apps/api/src/profile.ts';

test('profile accepts names in local scripts and rejects unsafe or extra input', () => {
  assert.deepEqual(profileInput({ displayName: '  ሰላም ተስፋዬ  ' }), { displayName: 'ሰላም ተስፋዬ' });
  assert.equal(profileInput({ displayName: 'a'.repeat(80) }).displayName.length, 80);
  for (const value of [null, [], {}, { displayName: null }, { displayName: '' },
    { displayName: '   ' }, { displayName: 'a'.repeat(81) }, { displayName: 'a\nb' },
    { displayName: 'a\u202eb' }, { displayName: 'Name', id: 'other' }]) {
    assert.throws(() => profileInput(value), error => error.status === 400);
  }
});
