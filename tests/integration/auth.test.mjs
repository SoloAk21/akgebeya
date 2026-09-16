import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { createHealthServer } from '../../apps/api/src/server.ts';
import { createAuthHandler } from '../../apps/api/src/auth.ts';
import { getDatabase, disconnectDatabase } from '../../apps/api/src/database.ts';
import { digest } from '../../apps/api/src/auth-security.ts';

test('real authentication lifecycle, failure cases, expiry, logout and database invariants', async () => {
  const database = getDatabase();
  const email = `auth-test-${randomUUID()}@example.test`;
  const password = 'AkGebeya test passphrase 2026!';
  const origin = 'http://127.0.0.1:3000';
  // An isolated loopback source avoids consuming the user's development rate budget.
  const localAddress = '127.0.0.2';
  let server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }));
  async function start() { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  async function stop() { await new Promise(resolve => server.close(resolve)); }
  await start();
  async function call(path, { method = 'POST', data, cookie, requestOrigin = origin, contentType = 'application/json', raw } = {}) {
    const encoded = raw ?? (data ? JSON.stringify(data) : '{}');
    return new Promise((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: server.address().port, localAddress,
        path: `/api/auth/${path}`, method, headers: { Origin: requestOrigin, 'Content-Type': contentType,
          ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { 'Content-Length': Buffer.byteLength(encoded) } : {}) } }, response => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(text) }));
      });
      request.on('error', reject);
      request.end(method === 'POST' ? encoded : undefined);
    });
  }
  const cookieOf = response => response.headers['set-cookie'][0].split(';')[0];
  const input = { email, password };
  try {
    assert.equal((await call('session', { method: 'GET' })).status, 401);
    assert.equal((await call('register', { data: input, requestOrigin: 'https://attacker.example' })).status, 403);
    assert.equal((await call('register', { data: input, requestOrigin: '' })).status, 403);
    assert.equal((await call('register', { data: input, contentType: 'text/plain' })).status, 415);
    assert.equal((await call('register', { raw: '{bad' })).status, 400);
    assert.equal((await call('register', { raw: 'x'.repeat(5000) })).status, 413);
    assert.equal((await call('register', { data: { email, password: 'short' } })).status, 400);
    const created = await call('register', { data: input });
    assert.equal(created.status, 201);
    assert.deepEqual(Object.keys(created.body.user).sort(), ['email', 'id']);
    assert.match(created.headers['set-cookie'][0], /HttpOnly/);
    assert.match(created.headers['set-cookie'][0], /SameSite=Lax/);
    assert.match(created.headers['set-cookie'][0], /Max-Age=604800/);
    assert.equal(created.headers['cache-control'], 'no-store');
    const firstCookie = cookieOf(created);
    const rawToken = firstCookie.split('=')[1];
    const account = await database.account.findUniqueOrThrow({ where: { email } });
    assert.notEqual(account.passwordHash, password);
    assert.match(account.passwordHash, /^scrypt\$/);
    const stored = await database.session.findUniqueOrThrow({ where: { tokenHash: digest(rawToken) } });
    assert.equal(stored.accountId, account.id);
    assert.notEqual(stored.tokenHash, rawToken);
    assert.equal((await call('register', { data: { email: email.toUpperCase(), password } })).status, 409);
    assert.equal(await database.account.count({ where: { email } }), 1);
    assert.equal(await database.session.count({ where: { accountId: account.id } }), 1);
    assert.equal((await call('login', { data: { email, password: 'Wrong passphrase 2026!' } })).status, 401);
    assert.equal((await call('session', { method: 'GET', cookie: 'akgebeya_session=' + '0'.repeat(64) })).status, 401);
    assert.equal((await call('session', { method: 'GET', cookie: firstCookie })).body.user.id, account.id);
    // Restart the HTTP server; the database-backed session remains valid.
    await stop();
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }));
    await start();
    assert.equal((await call('session', { method: 'GET', cookie: firstCookie })).status, 200);
    const login = await call('login', { data: input, cookie: firstCookie });
    assert.equal(login.status, 200);
    const secondCookie = cookieOf(login);
    assert.notEqual(firstCookie, secondCookie);
    assert.equal((await call('session', { method: 'GET', cookie: firstCookie })).status, 401);
    assert.equal((await call('logout', { cookie: secondCookie })).status, 200);
    assert.equal((await call('session', { method: 'GET', cookie: secondCookie })).status, 401);
    assert.equal((await call('logout', { cookie: secondCookie })).status, 200);
    const expiryLogin = await call('login', { data: input });
    const expiryCookie = cookieOf(expiryLogin);
    await database.session.update({ where: { tokenHash: digest(expiryCookie.split('=')[1]) }, data: { expiresAt: new Date(0) } });
    assert.equal((await call('session', { method: 'GET', cookie: expiryCookie })).status, 401);
    await stop();
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin: 'https://akgebeya.example', secure: true }));
    await start();
    const secureLogin = await call('login', { data: input, requestOrigin: 'https://akgebeya.example' });
    assert.equal(secureLogin.status, 200);
    assert.match(secureLogin.headers['set-cookie'][0], /^__Host-akgebeya_session=/);
    assert.match(secureLogin.headers['set-cookie'][0], /; Secure/);
    assert.equal((await call('logout', { cookie: cookieOf(secureLogin), requestOrigin: 'https://akgebeya.example' })).status, 200);
    await stop();
    server = createHealthServer(undefined, createAuthHandler(getDatabase, { origin, secure: false }));
    await start();
    // Six consumed attempts so far. Attempts 7–10 are rejected credentials; 11 is throttled.
    for (let i = 0; i < 4; i++) assert.equal((await call('login', { data: { email, password: 'Wrong passphrase 2026!' } })).status, 401);
    const limited = await call('login', { data: input });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers['retry-after'], '900');
    // A foreign-origin request must never revoke the session or reach the database operation.
    assert.equal((await call('logout', { cookie: expiryCookie, requestOrigin: 'https://attacker.example' })).status, 403);
  } finally {
    // Only this test's uniquely identified disposable account/session and counters are removed.
    await database.account.deleteMany({ where: { email } });
    const window = Math.floor(Date.now() / (15 * 60 * 1000));
    const keys = [window, window - 1].flatMap(w => [`email:${email}`, `ip:${localAddress}`].map(value => digest(`${w}:${value}`)));
    await database.authAttempt.deleteMany({ where: { key: { in: keys } } });
    await stop();
    await disconnectDatabase();
  }
});
