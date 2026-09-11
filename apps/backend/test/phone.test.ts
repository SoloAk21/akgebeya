import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { decodeJwt } from 'jose';
import { phoneSchema } from '../src/auth/phone-input.js';
import { hashOtp, matchesOtp } from '../src/auth/phone-hash.js';
import { parseConfig, parsePhoneOtpConfig } from '../src/config.js';
import { createOtpTransport } from '../src/auth/phone-transport.js';
import { createApp } from '../src/app.js';
import { HttpError } from '../src/errors.js';
import { hashSessionIdentifier } from '../src/auth/tokens.js';
import { createPhoneFixture, wrongOtp } from './phone-fixture.js';
import { withServer } from './helpers.js';

const denied = (error: unknown) => error instanceof HttpError && error.code === 'UNAUTHORIZED';
const throttled = (error: unknown) => error instanceof HttpError && error.code === 'TOO_MANY_REQUESTS';
const phone = '+251912345678';

test('Ethiopian mobile normalization accepts 09/07 and +2519/+2517 and rejects unsupported forms', () => {
  for (const [input, expected] of [['0912345678', phone], [phone, phone],
    ['0712345678', '+251712345678'], ['+251712345678', '+251712345678'], [' 0912345678 ', phone]]) {
    assert.equal(phoneSchema.parse(input), expected);
  }
  for (const input of ['', '912345678', '251912345678', '+2510912345678', '+251112345678',
    '+254712345678', '091234567', '09123456789', '09abc45678', '+251 912345678', null, 912345678]) {
    assert.ok(!phoneSchema.safeParse(input).success);
  }
});

test('OTP hashing binds the secret, challenge, phone and code with constant-time hash comparison', () => {
  const secret = randomBytes(32);
  const id = randomUUID();
  const code = randomBytes(16).toString('hex');
  const hash = hashOtp(secret, id, phone, code);
  assert.ok(/^[a-f0-9]{64}$/.test(hash) && hash !== code);
  assert.ok(matchesOtp(hash, hashOtp(secret, id, phone, code)));
  for (const candidate of [hashOtp(randomBytes(32), id, phone, code), hashOtp(secret, randomUUID(), phone, code),
    hashOtp(secret, id, '+251712345678', code), hashOtp(secret, id, phone, code + 'x'), 'invalid']) {
    assert.ok(!matchesOtp(hash, candidate));
  }
});

test('request stores only keyed hash, enforces cooldown, and a resend replaces the old challenge', async () => {
  const f = createPhoneFixture();
  const first = await f.service.request('0912345678');
  assert.equal(f.challenge()?.phone, phone);
  assert.ok(f.challenge()?.otpHash === hashOtp(f.config.secret!, first.challengeId, phone, f.transport.latest().otp));
  assert.ok(!Object.values(first).some(value => value === f.transport.latest().otp));
  await assert.rejects(() => f.service.request(phone), throttled);
  const previous = f.transport.latest();
  f.advance(f.config.cooldownSeconds);
  const next = await f.service.request(phone);
  assert.ok(first.challengeId !== next.challengeId);
  await assert.rejects(() => f.service.verify({ phone, challengeId: first.challengeId, otp: previous.otp }), denied);
  assert.equal(f.challenge()?.attemptCount, 0);
});

test('correct OTP consumes the challenge and creates a hash-only session; replay fails', async () => {
  const f = createPhoneFixture();
  await f.service.request(phone);
  const delivery = f.transport.latest();
  const result = await f.service.verify({ phone: '0912345678', challengeId: delivery.challengeId, otp: delivery.otp });
  assert.ok(f.challenge()?.consumedAt instanceof Date);
  const context = await f.auth.service.authenticate(result.token);
  assert.equal(context.user.phone, phone); assert.equal(context.user.role, 'USER');
  const jti = String(decodeJwt(result.token).jti);
  const stored = f.auth.repository.sessions.get(hashSessionIdentifier(jti));
  assert.ok(stored && stored.tokenHash !== jti && stored.tokenHash !== result.token);
  await assert.rejects(() => f.service.verify({ phone, challengeId: delivery.challengeId, otp: delivery.otp }), denied);
  f.advance(f.config.cooldownSeconds);
  await f.service.request(phone);
  const again = f.transport.latest();
  const second = await f.service.verify({ phone, challengeId: again.challengeId, otp: again.otp });
  assert.ok(result.token !== second.token);
  assert.equal((await f.auth.service.authenticate(second.token)).user.id, context.user.id);
});

test('failed attempts persist, limit revokes the challenge, and correct OTP cannot bypass exhaustion', async () => {
  const f = createPhoneFixture();
  await f.service.request(phone);
  const delivery = f.transport.latest();
  for (let attempt = 1; attempt <= f.config.maxAttempts; attempt++) {
    await assert.rejects(() => f.service.verify({ phone, challengeId: delivery.challengeId, otp: wrongOtp(delivery.otp) }), denied);
    assert.equal(f.challenge()?.attemptCount, attempt);
  }
  assert.ok(f.challenge()?.revokedAt instanceof Date);
  await assert.rejects(() => f.service.verify({ phone, challengeId: delivery.challengeId, otp: delivery.otp }), denied);
  assert.equal(f.auth.repository.sessions.size, 0);
});

test('expired, revoked and mismatched challenges fail closed', async () => {
  for (const scenario of ['expired', 'revoked', 'mismatch']) {
    const f = createPhoneFixture();
    await f.service.request(phone);
    const delivery = f.transport.latest();
    if (scenario === 'expired') f.advance(f.config.ttlSeconds);
    if (scenario === 'revoked') f.challenge()!.revokedAt = f.auth.getNow();
    await assert.rejects(() => f.service.verify({ phone,
      challengeId: scenario === 'mismatch' ? randomUUID() : delivery.challengeId, otp: delivery.otp }), denied);
    assert.equal(f.auth.repository.sessions.size, 0);
  }
});

test('production cannot enable test transport; disabled transport and missing secrets fail safely', async () => {
  assert.throws(() => parsePhoneOtpConfig({ NODE_ENV: 'production', PHONE_OTP_TRANSPORT: 'test-ipc' }));
  assert.throws(() => parsePhoneOtpConfig({ PHONE_OTP_TRANSPORT: 'test-ipc', PHONE_OTP_HASH_SECRET: 'private-invalid' }),
    error => error instanceof Error && !error.message.includes('private-invalid'));
  assert.throws(() => parsePhoneOtpConfig({ PHONE_OTP_TTL_SECONDS: '30', PHONE_OTP_COOLDOWN_SECONDS: '60' }));
  const transport = createOtpTransport(parsePhoneOtpConfig({ NODE_ENV: 'production' }));
  assert.equal(transport.available, false);
  const f = createPhoneFixture(); f.transport.available = false;
  await assert.rejects(() => f.service.request(phone),
    error => error instanceof HttpError && error.code === 'SERVICE_UNAVAILABLE');
  assert.equal(f.challenge(), null);
});

test('phone HTTP endpoints validate request shapes and never return OTP; reuse current-user/logout', async () => {
  const f = createPhoneFixture();
  await withServer(createApp(parseConfig({ NODE_ENV: 'test' }), f.auth.service, undefined, f.service), async base => {
    const post = (path: string, body: unknown) => fetch(base + '/api/v1/auth/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    for (const body of [{}, { phone: 'invalid' }, { phone, userId: randomUUID() }, { phone, role: 'ADMIN' }]) {
      const result = await post('phone/request-otp', body);
      assert.equal(result.status, 400); await result.arrayBuffer();
    }
    const requested = await post('phone/request-otp', { phone });
    assert.equal(requested.status, 200);
    assert.equal(requested.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys(await requested.json()).sort(), ['challengeId', 'expiresAt', 'resendAvailableAt']);
    const delivery = f.transport.latest();
    const invalid = await post('phone/verify-otp', { phone, challengeId: delivery.challengeId, otp: 'invalid' });
    assert.equal(invalid.status, 400); await invalid.arrayBuffer();
    const verified = await post('phone/verify-otp', { phone, challengeId: delivery.challengeId, otp: delivery.otp });
    assert.equal(verified.status, 200);
    const body = await verified.json() as { token: string; expiresAt: string };
    assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'token']);
    const headers = { Authorization: 'Bearer ' + body.token };
    const me = await fetch(base + '/api/v1/auth/me', { headers });
    assert.equal(me.status, 200); await me.arrayBuffer();
    const logout = await fetch(base + '/api/v1/auth/logout', { method: 'POST', headers });
    assert.equal(logout.status, 200); await logout.arrayBuffer();
    const replay = await fetch(base + '/api/v1/auth/me', { headers });
    assert.equal(replay.status, 401); await replay.arrayBuffer();
  });
});

test('disabled production phone endpoints return safe 503 JSON without creating challenges', async () => {
  const f = createPhoneFixture();
  f.transport.available = false;
  await withServer(createApp(parseConfig({ NODE_ENV: 'production' }), f.auth.service, undefined, f.service), async base => {
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    for (const [path, body] of [
      ['request-otp', { phone }],
      ['verify-otp', { phone, challengeId: randomUUID(), otp }],
    ] as const) {
      const response = await fetch(base + '/api/v1/auth/phone/' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' } });
    }
    assert.equal(f.challenge(), null);
    assert.equal(f.transport.deliveries.length, 0);
  });
});
