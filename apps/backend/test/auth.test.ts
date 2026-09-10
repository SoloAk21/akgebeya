import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { decodeJwt, SignJWT } from 'jose';
import { createApp } from '../src/app.js';
import { parseConfig, parseAuthConfig } from '../src/config.js';
import { HttpError, errorHandler } from '../src/errors.js';
import { authenticate, requireRoles } from '../src/auth/middleware.js';
import { hashSessionIdentifier } from '../src/auth/tokens.js';
import { createAuthFixture } from './auth-fixture.js';
import { withServer } from './helpers.js';

const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
const isUnauthorized = (error: unknown) => error instanceof HttpError && error.code === 'UNAUTHORIZED';
const appFor = (fixture: ReturnType<typeof createAuthFixture>) => createApp(parseConfig({ NODE_ENV: 'test' }), fixture.service);

test('auth endpoints reject absent, malformed, and client-invented credentials with safe 401 JSON', async () => {
  const fixture = createAuthFixture();
  await withServer(appFor(fixture), async base => {
    for (const [path, method] of [['me', 'GET'], ['logout', 'POST']]) {
      for (const authorization of ['', 'Basic abc', 'Bearer invalid', 'Bearer a.b.c']) {
        const response = await fetch(`${base}/api/v1/auth/${path}`, { method,
          headers: { authorization, 'x-user-id': fixture.user.id, 'x-role': 'ADMIN' } });
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), unauthorized);
        assert.equal(response.headers.get('www-authenticate'), 'Bearer');
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    }
  });
});

test('me returns only database-derived user fields and rejects ID/role overrides', async () => {
  const fixture = createAuthFixture();
  const { token } = await fixture.service.createSessionForVerifiedUser(fixture.user.id);
  const claims = decodeJwt(token);
  const stored = [...fixture.repository.sessions.values()][0]!;
  assert.equal(stored.tokenHash, hashSessionIdentifier(String(claims.jti)));
  assert.notEqual(stored.tokenHash, claims.jti);
  assert.equal(JSON.stringify(stored).includes(token), false);
  assert.equal(claims.role, undefined);
  await withServer(appFor(fixture), async base => {
    const response = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}`, 'x-role': 'ADMIN', 'x-user-id': randomUUID() } });
    assert.equal(response.status, 200);
    const { status: _status, deletedAt: _deletedAt, ...expected } = fixture.user;
    assert.deepEqual(await response.json(), { user: expected });
    for (const path of ['/api/v1/auth/me?userId=other', '/api/v1/auth/me?role=ADMIN']) {
      const invalid = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
    }
    const invalidLogout = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ userId: randomUUID() }) });
    assert.equal(invalidLogout.status, 400);
    await invalidLogout.arrayBuffer();
    assert.equal(stored.revokedAt, null);
  });
});

test('logout revokes only the authenticated session and replay returns 401', async () => {
  const fixture = createAuthFixture();
  const first = await fixture.service.createSessionForVerifiedUser(fixture.user.id);
  const second = await fixture.service.createSessionForVerifiedUser(fixture.user.id);
  await withServer(appFor(fixture), async base => {
    const logout = await fetch(`${base}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${first.token}` } });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { status: 'ok' });
    for (const [path, method] of [['me', 'GET'], ['logout', 'POST']]) {
      const replay = await fetch(`${base}/api/v1/auth/${path}`, { method, headers: { authorization: `Bearer ${first.token}` } });
      assert.equal(replay.status, 401);
      assert.deepEqual(await replay.json(), unauthorized);
    }
    assert.ok([...fixture.repository.sessions.values()][0]?.revokedAt);
    assert.equal((await fixture.service.authenticate(second.token)).user.id, fixture.user.id);
  });
});

test('JWT and database expiration, revocation, missing sessions, and inactive/deleted users fail closed', async () => {
  for (const scenario of ['jwt-expired', 'db-expired', 'revoked', 'missing-session', 'suspended', 'deleted', 'wrong-user']) {
    const fixture = createAuthFixture();
    const issued = await fixture.service.createSessionForVerifiedUser(fixture.user.id);
    const session = [...fixture.repository.sessions.values()][0]!;
    if (scenario === 'jwt-expired') fixture.setNow(issued.expiresAt);
    if (scenario === 'db-expired') session.expiresAt = fixture.getNow();
    if (scenario === 'revoked') session.revokedAt = fixture.getNow();
    if (scenario === 'missing-session') fixture.repository.sessions.clear();
    if (scenario === 'suspended') fixture.user.status = 'SUSPENDED';
    if (scenario === 'deleted') fixture.user.deletedAt = fixture.getNow();
    if (scenario === 'wrong-user') session.userId = randomUUID();
    await assert.rejects(() => fixture.service.authenticate(issued.token), isUnauthorized, scenario);
    await withServer(appFor(fixture), async base => {
      const response = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${issued.token}` } });
      assert.equal(response.status, 401, scenario);
      assert.deepEqual(await response.json(), unauthorized);
    });
  }
});

test('wrong signature/algorithm/issuer/audience, future/missing/oversized claims, and injected role are rejected', async () => {
  const fixture = createAuthFixture();
  const issued = await fixture.service.createSessionForVerifiedUser(fixture.user.id);
  const claims = decodeJwt(issued.token);
  for (const scenario of ['signature', 'algorithm', 'issuer', 'audience', 'future', 'missing-exp', 'role', 'long-life', 'bad-sub']) {
    const modified = { ...claims };
    let key = fixture.config.secret;
    let algorithm = 'HS256';
    if (scenario === 'signature') key = randomBytes(32);
    if (scenario === 'algorithm') algorithm = 'HS384';
    if (scenario === 'issuer') modified.iss = 'other';
    if (scenario === 'audience') modified.aud = 'other';
    if (scenario === 'future') modified.iat = Math.floor(fixture.getNow().getTime() / 1000) + 10;
    if (scenario === 'missing-exp') delete modified.exp;
    if (scenario === 'role') modified.role = 'ADMIN';
    if (scenario === 'long-life') modified.exp = Number(modified.iat) + 100000;
    if (scenario === 'bad-sub') modified.sub = 'not-a-uuid';
    const token = await new SignJWT(modified).setProtectedHeader({ alg: algorithm, typ: 'JWT' }).sign(key);
    await assert.rejects(() => fixture.service.authenticate(token), isUnauthorized, scenario);
  }
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
  await assert.rejects(() => fixture.service.authenticate(unsigned), isUnauthorized);
});

test('RBAC requires authentication and uses the current database role, including immediate demotion', async () => {
  const fixture = createAuthFixture();
  const issued = await fixture.service.createSessionForVerifiedUser(fixture.user.id);
  const app = express();
  app.get('/admin', authenticate(fixture.service), requireRoles('ADMIN'), (_req, res) => { res.json({ ok: true }); });
  app.get('/missing-auth', requireRoles('ADMIN'), (_req, res) => { res.json({ ok: true }); });
  app.use(errorHandler);
  await withServer(app, async base => {
    const missing = await fetch(`${base}/missing-auth`);
    assert.equal(missing.status, 401); await missing.arrayBuffer();
    for (const role of ['USER', 'ADMIN', 'USER'] as const) {
      fixture.user.role = role;
      const response = await fetch(`${base}/admin`, { headers: { authorization: `Bearer ${issued.token}`, 'x-role': 'ADMIN' } });
      assert.equal(response.status, role === 'ADMIN' ? 200 : 403);
      assert.deepEqual(await response.json(), role === 'ADMIN' ? { ok: true } : { error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }
  });
  assert.throws(() => requireRoles());
});

test('duplicate Authorization headers are rejected instead of choosing a credential', async () => {
  const fixture = createAuthFixture();
  const issued = await fixture.service.createSessionForVerifiedUser(fixture.user.id);
  await withServer(appFor(fixture), async base => {
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(`${base}/api/v1/auth/me`, { headers: ['Host', new URL(base).host, 'Authorization', `Bearer ${issued.token}`, 'Authorization', `Bearer ${issued.token}`] }, response => {
        try { assert.equal(response.statusCode, 401); response.resume(); response.on('end', resolve); }
        catch (error) { reject(error); }
      });
      request.on('error', reject); request.end();
    });
  });
});

test('session creation cannot use a missing/inactive user; authentication config has no default secret', async () => {
  const fixture = createAuthFixture();
  await assert.rejects(() => fixture.service.createSessionForVerifiedUser(randomUUID()), isUnauthorized);
  fixture.user.status = 'DEACTIVATED';
  await assert.rejects(() => fixture.service.createSessionForVerifiedUser(fixture.user.id), isUnauthorized);
  assert.equal(fixture.repository.sessions.size, 0);
  for (const AUTH_JWT_SECRET of [undefined, '', 'weak-secret']) {
    assert.throws(() => parseAuthConfig({ AUTH_JWT_SECRET }), { message: 'Invalid authentication configuration: AUTH_JWT_SECRET' });
  }
  assert.throws(() => parseAuthConfig({ AUTH_JWT_SECRET: randomBytes(32).toString('base64url'), AUTH_SESSION_TTL_SECONDS: '0' }), /AUTH_SESSION_TTL_SECONDS/);
});

test('database failures return a safe 500 without tokens or database details', async context => {
  const fixture = createAuthFixture();
  const issued = await fixture.service.createSessionForVerifiedUser(fixture.user.id);
  context.mock.method(fixture.repository, 'findSession', async () => { throw new Error('private database detail'); });
  const logged: unknown[][] = [];
  context.mock.method(console, 'error', (...args: unknown[]) => { logged.push(args); });
  await withServer(appFor(fixture), async base => {
    const response = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${issued.token}` } });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
  assert.equal(JSON.stringify(logged).includes(issued.token), false);
  assert.equal(JSON.stringify(logged).includes('private database detail'), false);
});
