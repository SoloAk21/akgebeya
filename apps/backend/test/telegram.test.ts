import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { decodeJwt } from 'jose';
import { parseConfig, parseTelegramConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/errors.js';
import { TelegramVerifier, type TelegramIdentity } from '../src/auth/telegram-verifier.js';
import { TelegramAuthService } from '../src/auth/telegram-service.js';
import { hashSessionIdentifier } from '../src/auth/tokens.js';
import { createAuthFixture } from './auth-fixture.js';
import { withServer } from './helpers.js';
import { signedInitData, telegramConfig, telegramValues } from './telegram-fixture.js';

const denied = (error: unknown) => error instanceof HttpError && error.code === 'UNAUTHORIZED';

test('Telegram official HMAC verification accepts reordered fields, signature, encoded Unicode, plus and large IDs', () => {
  const config = telegramConfig();
  const now = new Date();
  const values = { ...telegramValues(2 ** 52 - 1, now), signature: 'third-party-signature', query_id: 'a+b = c' };
  values.user = JSON.stringify({ id: 2 ** 52 - 1, first_name: 'ሰላም +', language_code: 'am-ET', role: 'ADMIN' });
  const raw = signedInitData(config.botToken, values);
  const verifier = new TelegramVerifier(config, () => now);
  assert.deepEqual(verifier.verify(raw.split('&').reverse().join('&')), {
    telegramId: BigInt(2 ** 52 - 1), displayName: 'ሰላም +', preferredLocale: 'am',
  });
  const modified = new URLSearchParams(raw);
  modified.set('signature', 'modified');
  assert.throws(() => verifier.verify(modified.toString()), denied);
});

test('Telegram rejects invalid hash, tampering, wrong bot, stale/future dates, malformed and missing fields', () => {
  const config = telegramConfig();
  const now = new Date();
  const verifier = new TelegramVerifier(config, () => now);
  const values = telegramValues(undefined, now);
  const valid = signedInitData(config.botToken, values);
  const modified = new URLSearchParams(valid);
  modified.set('user', JSON.stringify({ id: 123, first_name: 'Attacker' }));
  const wrongHash = new URLSearchParams(valid);
  wrongHash.set('hash', '0'.repeat(64));
  const cases = [
    '', 'user', '%ZZ=x', 'user=%C0%AF', valid + '&', valid + '&auth_date=1',
    valid + '&%61uth_date=1', valid + '&unknown=x', valid.replace('hash=', 'hash=x'),
    wrongHash.toString(), modified.toString(), signedInitData(telegramConfig().botToken, values),
    signedInitData(config.botToken, { ...values, auth_date: String(Math.floor(now.getTime() / 1000) - 300) }),
    signedInitData(config.botToken, { ...values, auth_date: String(Math.floor(now.getTime() / 1000) + 1) }),
    signedInitData(config.botToken, { ...values, auth_date: '1e9' }),
    signedInitData(config.botToken, { ...values, auth_date: '-1' }),
    signedInitData(config.botToken, { user: values.user }),
    signedInitData(config.botToken, { auth_date: values.auth_date }),
    signedInitData(config.botToken, { ...values, user: '{' }),
    signedInitData(config.botToken, { ...values, query_id: 'injected\nuser=x' }),
    new URLSearchParams(values).toString(),
  ];
  for (const raw of cases) assert.throws(() => verifier.verify(raw), denied);
  for (const user of [null, [], {}, { id: '123', first_name: 'A' }, { id: 0, first_name: 'A' },
    { id: 1.5, first_name: 'A' }, { id: 2 ** 52, first_name: 'A' }, { id: 1, first_name: ' ' },
    { id: 1, first_name: 'A', is_bot: true }]) {
    assert.throws(() => verifier.verify(signedInitData(config.botToken, { ...values, user: JSON.stringify(user) })), denied);
  }
  assert.ok(verifier.verify(signedInitData(config.botToken, {
    ...values, auth_date: String(Math.floor(now.getTime() / 1000) - 299),
  })));
});

test('Telegram endpoint validates input, resolves repeat identity, creates hashed sessions and reuses logout', async () => {
  const fixture = createAuthFixture();
  const config = telegramConfig();
  const identities = new Map<bigint, string>();
  let calls = 0;
  const repository = { async resolveUser(identity: TelegramIdentity) {
    calls++;
    const existing = identities.get(identity.telegramId);
    if (existing) return { id: existing };
    const user = { ...fixture.user, id: randomUUID(), email: null, phone: null,
      displayName: identity.displayName, preferredLocale: identity.preferredLocale };
    fixture.repository.users.set(user.id, user);
    identities.set(identity.telegramId, user.id);
    return { id: user.id };
  } };
  const service = new TelegramAuthService(new TelegramVerifier(config, fixture.getNow), repository, fixture.service);
  await withServer(createApp(parseConfig({ NODE_ENV: 'test' }), fixture.service, service), async base => {
    const post = (body: unknown, suffix = '') => fetch(base + '/api/v1/auth/telegram' + suffix, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    for (const body of [{}, { initData: 1 }, { initData: '' }, { initData: 'x', userId: fixture.user.id }, { initData: 'x', role: 'ADMIN' }]) {
      const response = await post(body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
    }
    const invalid = await post({ initData: 'invalid' });
    assert.equal(invalid.status, 401);
    assert.deepEqual(await invalid.json(), { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    assert.equal(calls, 0);
    const initData = signedInitData(config.botToken, telegramValues(undefined, fixture.getNow()));
    const unexpected = await post({ initData }, '?userId=attacker');
    assert.equal(unexpected.status, 400); await unexpected.arrayBuffer();
    const tokens: string[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await post({ initData });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json() as { token: string; expiresAt: string };
      assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'token']);
      const context = await fixture.service.authenticate(body.token);
      assert.equal(context.user.role, 'USER');
      assert.equal(context.user.email, null);
      assert.equal(context.user.preferredLocale, 'am');
      const jti = String(decodeJwt(body.token).jti);
      const row = fixture.repository.sessions.get(hashSessionIdentifier(jti));
      assert.ok(row && row.tokenHash !== jti && row.tokenHash !== body.token);
      assert.equal(row.expiresAt.toISOString(), body.expiresAt);
      tokens.push(body.token);
    }
    assert.equal(identities.size, 1);
    assert.equal(fixture.repository.sessions.size, 2);
    assert.ok(tokens[0] !== tokens[1]);
    const logout = await fetch(base + '/api/v1/auth/logout', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tokens[0] },
    });
    assert.equal(logout.status, 200); await logout.arrayBuffer();
    await assert.rejects(() => fixture.service.authenticate(tokens[0]!), denied);
    assert.ok(await fixture.service.authenticate(tokens[1]!));
    const id = identities.values().next().value!;
    fixture.repository.users.get(id)!.status = 'SUSPENDED';
    const suspended = await post({ initData });
    assert.equal(suspended.status, 401); await suspended.arrayBuffer();
    assert.equal(fixture.repository.sessions.size, 2);
  });
});

test('Telegram configuration fails safely and bounds freshness', () => {
  for (const input of [{}, { TELEGRAM_BOT_TOKEN: 'secret-invalid' },
    { ...{ TELEGRAM_BOT_TOKEN: telegramConfig().botToken }, TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: '601' }]) {
    assert.throws(() => parseTelegramConfig(input), error => error instanceof Error
      && error.message.startsWith('Invalid Telegram configuration:') && !error.message.includes('secret-invalid'));
  }
});


test('Telegram maps bounded Unicode names and rejects embedded controls', () => {
  const config = telegramConfig();
  const values = telegramValues();
  const verifier = new TelegramVerifier(config);
  const valid = signedInitData(config.botToken, { ...values,
    user: JSON.stringify({ id: 123, first_name: '😀'.repeat(100), last_name: '😀'.repeat(100), language_code: 'fr' }) });
  const identity = verifier.verify(valid);
  assert.equal(Array.from(identity.displayName).length, 120);
  assert.equal(identity.preferredLocale, 'en');
  assert.ok(!identity.displayName.includes('\ufffd'));
  const invalid = signedInitData(config.botToken, { ...values,
    user: JSON.stringify({ id: 123, first_name: 'Name\u0000' }) });
  assert.throws(() => verifier.verify(invalid), denied);
});

test('Telegram repository failure produces only safe JSON and static diagnostics', async () => {
  const fixture = createAuthFixture();
  const config = telegramConfig();
  const service = new TelegramAuthService(new TelegramVerifier(config), {
    async resolveUser() { throw new Error('private-database-detail'); },
  }, fixture.service);
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    await withServer(createApp(parseConfig({ NODE_ENV: 'test' }), fixture.service, service), async base => {
      const response = await fetch(base + '/api/v1/auth/telegram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: signedInitData(config.botToken, telegramValues()) }),
      });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    });
    assert.deepEqual(logs, [['Unhandled request error']]);
    assert.equal(fixture.repository.sessions.size, 0);
  } finally { console.error = original; }
});
