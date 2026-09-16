import assert from 'node:assert/strict';
import test from 'node:test';
import { credentials, hashPassword, verifyPassword, tokenFromCookie, sessionToken, digest } from '../apps/api/src/auth-security.ts';

test('credentials normalize emails but preserve passwords and reject invalid bounds', () => {
  const password = '  a long passphrase  ';
  assert.deepEqual(credentials({ email: ' Test@Example.com ', password }), { email: 'test@example.com', password });
  for (const value of [null, [], {}, { email: 'bad', password }, { email: 'a@b.co', password: 'short' },
    { email: 'a@b.co', password: 'x'.repeat(129) }, { email: 'a@b.co', password, role: 'ADMIN' }]) {
    assert.throws(() => credentials(value));
  }
  assert.equal(credentials({ email: 'a@b.co', password: 'x'.repeat(128) }).password.length, 128);
});

test('salted scrypt verifies passwords and performs an unknown-user comparison', async () => {
  const password = 'A safe sample passphrase 2026!';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('Wrong sample passphrase!', first), false);
  assert.equal(await verifyPassword(password, undefined), false);
});

test('only one correctly shaped cookie is accepted and tokens carry 256 bits', () => {
  const token = sessionToken();
  assert.equal(token.length, 64);
  assert.notEqual(digest(token), token);
  assert.equal(tokenFromCookie(`other=1; session=${token}`, 'session'), token);
  assert.equal(tokenFromCookie(`session=${token}; session=${token}`, 'session'), undefined);
  assert.equal(tokenFromCookie('session=malformed', 'session'), undefined);
});
