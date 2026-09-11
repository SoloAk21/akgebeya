import { AuthService } from '../src/auth/service.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { parseConfig, parseGoogleConfig } from '../src/config.js';
import { GoogleAuthService } from '../src/auth/google-service.js';
import { GoogleVerifier, normalizeGoogleCredential } from '../src/auth/google-verifier.js';
import { googleFixture } from './google-fixture.js';
import { createAuthFixture } from './auth-fixture.js';
import { withServer } from './helpers.js';

test('Google verifies signature and maps only stable subject and normalized verified email', async () => {
  const f = await googleFixture();
  assert.deepEqual(await f.verifier.verify(await f.sign({ email: '  PERSON@EXAMPLE.COM  ', role: 'ADMIN' })),
    { googleSub: f.sub, email: 'person@example.com' });
  assert.deepEqual(await f.verifier.verify(await f.sign({ iss: 'accounts.google.com' })), { googleSub: f.sub, email: f.email });
});
test('Google fails closed for invalid signature, token, audience, issuer, expiry and unverified/malformed claims', async () => {
  const f = await googleFixture();
  const other = await googleFixture();
  const parts = (await f.sign()).split('.');
  const signature = parts[2]!;
  const tampered = parts[0] + '.' + parts[1] + '.' + (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  for (const token of ['invalid', tampered, await other.sign(), await f.sign({ aud: 'wrong' }),
    await f.sign({ aud: [f.clientId, 'other'] }), await f.sign({ azp: 'wrong' }),
    await f.sign({ iss: 'https://attacker.example' }), await f.sign({ exp: 1 }),
    await f.sign({ iat: Math.floor(Date.now() / 1000) + 100 }),
    await f.sign({ email_verified: false }), await f.sign({ email_verified: 'true' }),
    await f.sign({ exp: undefined }), await f.sign({ iat: undefined }), await f.sign({ sub: undefined }),
    await f.sign({ sub: ' ' }), await f.sign({ email: 'bad' }), await f.sign({ email_verified: undefined }),
  ]) await assert.rejects(f.verifier.verify(token), { code: 'UNAUTHORIZED' });
});
test('Google configuration is centralized, optional-unavailable, and rejects malformed audience safely', async () => {
  assert.deepEqual(parseGoogleConfig({}), { clientId: undefined });
  assert.throws(() => parseGoogleConfig({ GOOGLE_CLIENT_ID: 'invalid' }), /^Error: Invalid Google configuration: GOOGLE_CLIENT_ID$/);
  await assert.rejects(new GoogleVerifier({ clientId: undefined }).verify('invalid'), { code: 'SERVICE_UNAVAILABLE' });
});
test('Google HTTP rejects untrusted profile/roles and malformed input; issues shared hashed sessions and revokes logout', async () => {
  const f = await googleFixture();
  const auth = createAuthFixture();
  let resolutions = 0;
  const google = new GoogleAuthService(f.verifier, { withIdentity: async (identity, issue) => {
    assert.equal(identity.googleSub, f.sub); resolutions++;
    return issue(auth.user.id, auth.repository);
  } }, auth.config);
  await withServer(createApp(parseConfig({ NODE_ENV: 'test' }), new AuthService(auth.repository, auth.config), undefined, undefined, google), async base => {
    const post = (body: unknown) => fetch(base + '/api/v1/auth/google', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const body of [{}, null, { idToken: 123 }, { idToken: '' }, { idToken: 'invalid', role: 'ADMIN' },
      { idToken: 'invalid', email: f.email }]) assert.equal((await post(body)).status, 400);
    assert.equal((await post({ idToken: 'invalid' })).status, 401);
    assert.equal(resolutions, 0);
    const response = await post({ idToken: await f.sign() });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as { token: string; expiresAt: string };
    assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'token']);
    assert.ok([...auth.repository.sessions.keys()].every(hash => /^[a-f0-9]{64}$/.test(hash) && hash !== body.token));
    const headers = { Authorization: 'Bearer ' + body.token };
    assert.equal((await fetch(base + '/api/v1/auth/me', { headers })).status, 200);
    assert.equal((await fetch(base + '/api/v1/auth/logout', { method: 'POST', headers })).status, 200);
    assert.equal((await fetch(base + '/api/v1/auth/me', { headers })).status, 401);
    assert.equal((await fetch(base + '/api/v1/auth/me')).status, 401);
  });
});

test('Google credential input trims only surrounding whitespace and rejects malformed compact JWTs', async () => {
  const f = await googleFixture();
  const token = await f.sign();
  for (const input of [token + '\n', token + '\r\n', '  ' + token + '  ', '\t\r\n' + token + '\r\n ']) {
    assert.ok(normalizeGoogleCredential(input) === token, 'Normalization must preserve all token characters');
    await f.verifier.verify(input);
  }
  const parts = token.split('.');
  const invalid = [
    '"' + token + '"', "'" + token + "'",
    token.slice(0, 5) + ' ' + token.slice(5),
    token.slice(0, 5) + '\r\n' + token.slice(5),
    token.slice(0, 5) + '\t' + token.slice(5),
    'extra text ' + token, token + ' extra text',
    parts.slice(0, 2).join('.'), token + '.extra',
    parts[0] + '..' + parts[2], '.' + parts[1] + '.' + parts[2],
    parts[0] + '.' + parts[1] + '.', token + '=', token + '\u200b',
  ];
  for (const input of invalid) {
    assert.throws(() => normalizeGoogleCredential(input), { category: 'TOKEN_FORMAT_INVALID' });
    await assert.rejects(f.verifier.verify(input), { code: 'UNAUTHORIZED', category: 'TOKEN_FORMAT_INVALID' });
  }
  // Alphabet-valid additions are never stripped; signature/header verification must still reject them.
  assert.ok(normalizeGoogleCredential(token + 'extra') === token + 'extra');
  await assert.rejects(f.verifier.verify(token + 'extra'), { code: 'UNAUTHORIZED' });
  await assert.rejects(f.verifier.verify('extra' + token), { code: 'UNAUTHORIZED' });
});
