import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { decodeJwt, SignJWT } from 'jose';
import { createDatabaseClient } from '../src/database.js';
import { loadAuthConfig, loadConfig } from '../src/config.js';
import { AuthService } from '../src/auth/service.js';
import { PrismaAuthRepository } from '../src/auth/repository.js';
import { hashSessionIdentifier } from '../src/auth/tokens.js';

async function verify() {
  if (loadConfig().nodeEnv === 'production') throw new Error('Run this fixture verification only in development/test.');
  const config = loadAuthConfig();
  const database = createDatabaseClient('pooled');
  let userId: string | undefined;
  let server: ReturnType<typeof spawn> | undefined;
  let serverClosed: Promise<unknown> | undefined;
  try {
    const user = await database.user.create({ data: { email: `manual-auth-${randomUUID()}@example.com`, displayName: 'Auth verification' } });
    userId = user.id;
    const service = new AuthService(new PrismaAuthRepository(database), config);
    const issued = await service.createSessionForVerifiedUser(user.id);
    const claims = decodeJwt(issued.token);
    const identifier = String(claims.jti);
    const stored = await database.session.findUniqueOrThrow({ where: { tokenHash: hashSessionIdentifier(identifier) } });
    assert.match(stored.tokenHash, /^[0-9a-f]{64}$/);
    assert.ok(stored.tokenHash !== identifier && stored.tokenHash !== issued.token);
    assert.equal(stored.revokedAt, null);

    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const address = reservation.address();
    assert.ok(address && typeof address !== 'string');
    const port = address.port;
    await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
    server = spawn(process.execPath, [fileURLToPath(new URL('../dist/server.js', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), windowsHide: true,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverClosed = once(server, 'close');
    const child = server;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Built server startup timed out')), 10_000);
      const finish = (error?: Error) => { clearTimeout(timeout); error ? reject(error) : resolve(); };
      child.once('error', () => finish(new Error('Could not start built server')));
      child.once('exit', () => finish(new Error('Built server exited before verification')));
      child.stdout?.on('data', chunk => { if (String(chunk).includes('Backend listening')) finish(); });
      child.stderr?.on('data', () => {}); // Never forward server diagnostics containing configuration.
    });
    const base = `http://127.0.0.1:${port}/api/v1/auth`;
    function curl(path: string, method: 'GET' | 'POST', token: string | undefined, expectedStatus: number, expectedBody: unknown) {
      const args = ['--silent', '--show-error', '--max-time', '15', '--request', method, '--write-out', '\n%{http_code}'];
      if (token) args.push('--header', '@-');
      args.push(`${base}/${path}`);
      const result = spawnSync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
        input: token ? `Authorization: Bearer ${token}\n` : undefined, encoding: 'utf8', windowsHide: true,
      });
      assert.equal(result.status, 0, 'curl failed');
      const split = result.stdout.lastIndexOf('\n');
      const status = Number(result.stdout.slice(split + 1));
      const body = JSON.parse(result.stdout.slice(0, split)) as unknown;
      assert.equal(status, expectedStatus);
      assert.deepEqual(body, expectedBody);
      console.log(`${method} /api/v1/auth/${path}: HTTP ${status} ${JSON.stringify(body)}`);
    }
    const unauthorized = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    curl('me', 'GET', undefined, 401, unauthorized);
    curl('logout', 'POST', undefined, 401, unauthorized);
    curl('me', 'GET', 'invalid.token.value', 401, unauthorized);
    curl('me', 'GET', issued.token, 200, { user: {
      id: user.id, email: user.email, phone: null, displayName: user.displayName, role: 'USER', preferredLocale: 'en',
    } });
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ ...claims, iat: now - 120, exp: now - 1 })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).sign(config.secret);
    curl('me', 'GET', expired, 401, unauthorized);
    curl('logout', 'POST', issued.token, 200, { status: 'ok' });
    const revoked = await database.session.findUniqueOrThrow({ where: { id: stored.id } });
    assert.ok(revoked.revokedAt instanceof Date);
    console.log('Session database state: hash-only identifier, matching expiration, revokedAt set after logout.');
    curl('me', 'GET', issued.token, 401, unauthorized);
    curl('logout', 'POST', issued.token, 401, unauthorized);
  } finally {
    server?.kill();
    if (serverClosed) await serverClosed;
    try {
      if (userId) {
        await database.user.delete({ where: { id: userId } });
        assert.equal(await database.session.count({ where: { userId } }), 0);
        console.log('Temporary verification user and sessions removed.');
      }
    } finally { await database.$disconnect(); }
  }
}

verify().catch(() => { console.error('Authentication verification failed; no tokens or credentials were logged.'); process.exitCode = 1; });
