import { readGoogleTestCredential, preflightGoogleTestCredential } from './google-test-credential.js';
import { VerificationDiagnostics, type VerificationFailure } from './google-verification-diagnostics.js';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { decodeJwt } from 'jose';
import { createDatabaseClient } from '../src/database.js';
import { loadConfig, loadGoogleConfig, loadAuthConfig, loadTelegramConfig, loadPhoneOtpConfig, parseAuthConfig, parseConfig } from '../src/config.js';
import { createApp } from '../src/app.js';
import { GoogleVerifier, normalizeGoogleCredential } from '../src/auth/google-verifier.js';
import { GoogleAuthService } from '../src/auth/google-service.js';
import { PrismaGoogleRepository } from '../src/auth/google-repository.js';
import { AuthService } from '../src/auth/service.js';
import { PrismaAuthRepository } from '../src/auth/repository.js';
import { hashSessionIdentifier } from '../src/auth/tokens.js';
import { googleFixture } from '../test/google-fixture.js';
import { withServer } from '../test/helpers.js';
import { withBuiltServer } from './verification-server.js';

const diagnostics = new VerificationDiagnostics();
const root = fileURLToPath(new URL('../../../', import.meta.url));
async function command(executable: string, args: string[], input = '') {
  return new Promise<string>((resolve, reject) => {
    const childEnvironment = { ...process.env };
    delete childEnvironment.AKGEBEYA_GOOGLE_TEST_ID_TOKEN;
    const child = spawn(executable, args, { cwd: root, env: childEnvironment, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(diagnostics.failure('COMMAND_TIMEOUT')); }, 180_000);
    child.stdout.on('data', chunk => { output += String(chunk); });
    child.stderr.on('data', () => {});
    child.once('error', () => { clearTimeout(timeout); reject(diagnostics.failure('COMMAND_START_FAILED')); });
    child.once('close', status => { clearTimeout(timeout); status === 0 ? resolve(output) : reject(diagnostics.failure('COMMAND_FAILED')); });
    child.stdin.end(input);
  });
}
async function main() {
  if (process.argv.includes('--credential-preflight-env')) {
    const result = preflightGoogleTestCredential(process.env);
    console.log(JSON.stringify(result));
    process.exitCode = result.code === 'FORMAT_ACCEPTABLE' ? 0 : 1;
    return;
  }
  const realEnv = process.argv.includes('--real-env');
  const realStdin = process.argv.includes('--real');
  const real = realEnv || realStdin;
  // Snapshot only the parent process input before dotenv loading, then prevent child inheritance.
  const privateEnvironment: NodeJS.ProcessEnv = {
    AKGEBEYA_GOOGLE_TEST_ID_TOKEN: process.env.AKGEBEYA_GOOGLE_TEST_ID_TOKEN,
  };
  delete process.env.AKGEBEYA_GOOGLE_TEST_ID_TOKEN;
  diagnostics.enter('environment/config validation');
  try {
    if (realEnv && realStdin) throw new Error();
    if (loadConfig().nodeEnv === 'production') throw new Error();
    loadAuthConfig(); loadTelegramConfig(); loadPhoneOtpConfig();
    if (real && !loadGoogleConfig().clientId) throw new Error();
  } catch { throw diagnostics.failure('CONFIGURATION_FAILED'); }
  const synthetic = await googleFixture();
  let credential = '';
  if (realEnv) {
    diagnostics.enter('private credential input');
    credential = readGoogleTestCredential(privateEnvironment, loadConfig().nodeEnv);
  } else if (realStdin) {
    delete privateEnvironment.AKGEBEYA_GOOGLE_TEST_ID_TOKEN;
    diagnostics.enter('private credential input');
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      credential += String(chunk);
      if (credential.length > 12_100) throw diagnostics.failure('INPUT_INVALID');
    }
    credential = normalizeGoogleCredential(credential);
  } else {
    delete privateEnvironment.AKGEBEYA_GOOGLE_TEST_ID_TOKEN;
    credential = await synthetic.sign();
  }
  delete process.env.AKGEBEYA_GOOGLE_TEST_ID_TOKEN;
  diagnostics.enter('Google signature/claims verification');
  const verifier = real ? new GoogleVerifier(loadGoogleConfig()) : synthetic.verifier;
  const identity = await verifier.verify(credential);
  diagnostics.enter('environment/config validation');
  const db = createDatabaseClient();
  const config = real ? loadAuthConfig() : parseAuthConfig({ AUTH_JWT_SECRET: randomBytes(32).toString('base64url') });
  const auth = new AuthService(new PrismaAuthRepository(db), config);
  const fixtureKey = randomBytes(32).toString('base64url');
  const tokens = new Map<string, string>([['valid', credential], ['repeat', credential], ['invalid', 'invalid']]);
  let ownedConflict: string | undefined;
  let before: Awaited<ReturnType<typeof db.user.findUnique>> = null;
  const ownedSessionIds = new Set<string>();
  let userId: string | undefined;
  let expectedExistingId: string | undefined;
  let prepared = false;
  let primaryFailure: VerificationFailure | undefined;
  const serialized = (value: unknown) => JSON.stringify(value, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v);
  try {
    diagnostics.enter('Neon user identity verification');
    before = await db.user.findUnique({ where: { googleSub: identity.googleSub } });
    const emailOwner = await db.user.findUnique({ where: { email: identity.email } });
    if (emailOwner && emailOwner.id !== before?.id) throw diagnostics.failure('ACCOUNT_LINKING_CONFLICT');
    expectedExistingId = before?.id;
    prepared = true;
    if (!real) {
      const conflict = await db.user.create({ data: { email: randomUUID() + '@example.com', displayName: 'Google manual conflict' } });
      ownedConflict = conflict.id;
      const other = await googleFixture();
      for (const [kind, token] of [
        ['signature', await other.sign()], ['audience', await synthetic.sign({ aud: 'wrong' })],
        ['issuer', await synthetic.sign({ iss: 'wrong' })], ['expired', await synthetic.sign({ exp: 1 })],
        ['unverified', await synthetic.sign({ email_verified: false })],
        ['emailConflict', await synthetic.sign({ sub: randomUUID(), email: conflict.email })],
        ['crossConflict', await synthetic.sign({ email: conflict.email })],
      ]) tokens.set(kind!, token!);
    }
    async function rememberSession(token: string) {
      const claims = decodeJwt(token);
      const hash = hashSessionIdentifier(z.string().parse(claims.jti));
      const issued = await db.session.findUniqueOrThrow({ where: { tokenHash: hash } });
      const subject = await db.user.findUniqueOrThrow({ where: { googleSub: identity.googleSub } });
      assert.equal(issued.userId, subject.id);
      // Track owned records before further checks so partial verification failures can clean up.
      ownedSessionIds.add(issued.id);
      userId ??= subject.id;
      const context = await auth.authenticate(token);
      const user = await db.user.findUniqueOrThrow({ where: { googleSub: identity.googleSub } });
      assert.equal(context.user.id, user.id);
      if (userId) assert.equal(userId, user.id);
      userId = user.id;
      ownedSessionIds.add(context.sessionId);
    }
    const fixture = express();
    fixture.use((req, res, next) => {
      const supplied = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from('Bearer ' + fixtureKey);
      res.set('Cache-Control', 'no-store');
      if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.sendStatus(403); return; }
      next();
    });
    fixture.use(express.json({ limit: '8kb' }));
    fixture.post('/session', async (req, res) => {
      try {
        const body = z.object({ token: z.string().max(4103) }).strict().parse(req.body);
        await rememberSession(body.token);
        res.json({ status: 'ok' });
      } catch (error) { diagnostics.report(error); res.status(500).json({ error: 'Session verification failed' }); }
    });
    fixture.post('/credential/:kind', (req, res) => {
      const token = tokens.get(req.params.kind);
      if (!token) { res.sendStatus(404); return; }
      res.json({ idToken: token });
    });
    async function run(base: string) {
      await withServer(fixture, async fixtureUrl => {
        async function curl(path: string, body?: unknown, session?: string) {
          const args = ['--silent', '--show-error', '--write-out', '\n%{http_code}'];
          let input = '';
          if (body !== undefined) {
            args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
            input = typeof body === 'string' ? body : JSON.stringify(body);
          }
          if (session) {
            args.push('--header', '@-'); input = 'Authorization: Bearer ' + session + '\n';
            if (path === 'logout') args.push('--request', 'POST');
          }
          args.push(base + '/' + path);
          const result = await command('curl.exe', args, input);
          const split = result.lastIndexOf('\n');
          const status = Number(result.slice(split + 1));
          diagnostics.http(status);
          try { return { status, body: JSON.parse(result.slice(0, split)) as Record<string, unknown> }; }
          catch { throw diagnostics.failure('RESPONSE_INVALID'); }
        }
        diagnostics.enter('negative HTTP checks');
        diagnostics.expectHttp(await curl('google', '{'), 400);
        diagnostics.expectHttp(await curl('google', {}), 400);
        diagnostics.expectHttp(await curl('google', { idToken: 'invalid' }), 401);
        diagnostics.enter('POST /api/v1/auth/google');
        const login = await curl('google', { idToken: credential });
        diagnostics.expectHttp(login, 200);
        const session = z.object({ token: z.string(), expiresAt: z.string().datetime() }).strict().parse(login.body);
        diagnostics.enter('session hash/revocation verification');
        await rememberSession(session.token);
        diagnostics.enter('GET /api/v1/auth/me');
        const me = await curl('me', undefined, session.token);
        diagnostics.expectHttp(me, 200);
        userId = z.object({ user: z.object({ id: z.string().uuid() }) }).parse(me.body).user.id;
        if (expectedExistingId) assert.equal(userId, expectedExistingId);
        diagnostics.enter('session hash/revocation verification');
        const hash = hashSessionIdentifier(String(decodeJwt(session.token).jti));
        const stored = await db.session.findUniqueOrThrow({ where: { tokenHash: hash } });
        assert.equal(stored.userId, userId);
        assert.ok(stored.tokenHash !== session.token && stored.tokenHash !== String(decodeJwt(session.token).jti));
        diagnostics.enter('POST /api/v1/auth/logout');
        diagnostics.expectHttp(await curl('logout', undefined, session.token), 200);
        diagnostics.enter('post-logout /auth/me rejection');
        diagnostics.expectHttp(await curl('me', undefined, session.token), 401);
        diagnostics.enter('session hash/revocation verification');
        assert.ok((await db.session.findUniqueOrThrow({ where: { id: stored.id } })).revokedAt);
        diagnostics.enter('repeat Google login');
        const again = await curl('google', { idToken: credential });
        diagnostics.expectHttp(again, 200);
        await rememberSession(String(again.body.token));
        assert.equal(z.object({ user: z.object({ id: z.string() }) }).parse(
          (await curl('me', undefined, String(again.body.token))).body).user.id, userId);
        console.log('PASS: curl Google login, malformed/invalid input, current user, logout/revocation and repeat identity.');

        diagnostics.enter('Postman collection');
        const template = JSON.parse(await readFile(new URL('../../../docs/postman/google-auth.postman_collection.json', import.meta.url), 'utf8')) as {
          variable: { key: string; value: string }[]; item: { name: string }[];
        };
        template.variable = [{ key: 'baseUrl', value: base }, { key: 'fixtureUrl', value: fixtureUrl }, { key: 'fixtureKey', value: fixtureKey }];
        if (real) template.item = template.item.filter(item => !['Invalid signature', 'Wrong audience', 'Wrong issuer', 'Expired token',
          'Unverified email', 'Existing email conflict', 'Cross-account conflict'].includes(item.name));
        const temporary = root + '.git/google-manual-' + randomUUID() + '.json';
        try {
          // Connection settings only; ID/session tokens are obtained in Postman's private runtime memory.
          await writeFile(temporary, JSON.stringify(template), { flag: 'wx' });
          await command(process.execPath, [root + 'node_modules/postman-cli/bin/postman.js', 'collection', 'run',
            temporary, '--no-report-events', '--silent']);
          console.log('PASS: Postman CLI (' + template.item.length + ' requests).');
        } finally { await unlink(temporary); }
      });
      diagnostics.enter('Neon user identity verification');
      const user = await db.user.findUniqueOrThrow({ where: { googleSub: identity.googleSub } });
      assert.equal(user.id, userId);
      assert.equal(await db.user.count({ where: { googleSub: identity.googleSub } }), 1);
      if (before) assert.equal(serialized(user), serialized(before));
      else assert.equal(user.email, identity.email);
      diagnostics.enter('session hash/revocation verification');
      const sessions = await db.session.findMany({ where: { userId: user.id, id: { in: [...ownedSessionIds] } } });
      assert.equal(sessions.length, 4);
      assert.equal(sessions.filter(s => s.revokedAt).length, 2);
      assert.ok(sessions.every(s => /^[a-f0-9]{64}$/.test(s.tokenHash) && !serialized(s).includes(credential)));
      assert.ok(!serialized(user).includes(credential));
      console.log('PASS: direct Neon unique identity, preserved user/contact data, hash-only sessions and logout state.');
    }
    if (real) {
      diagnostics.enter('backend startup');
      await withBuiltServer({ AKGEBEYA_GOOGLE_TEST_ID_TOKEN: undefined }, run);
    } else {
      const google = new GoogleAuthService(verifier, new PrismaGoogleRepository(db), config);
      await withServer(createApp(parseConfig({ NODE_ENV: 'test' }), auth, undefined, undefined, google), base => run(base + '/api/v1/auth'));
    }
    console.log(real ? 'PASS: REAL Google credential verified against Google keys and configured audience.' : 'Synthetic checks passed; REAL Google verification remains a separate required gate.');
  } catch (error) {
    primaryFailure = diagnostics.capture(error);
    throw primaryFailure;
  } finally {
    diagnostics.enter('cleanup');
    try {
      if (prepared) {
        const user = await db.user.findUnique({ where: { googleSub: identity.googleSub }, select: { id: true } });
        if (user) {
          await db.session.deleteMany({ where: { userId: user.id, id: { in: [...ownedSessionIds] } } });
          if (!before && user.id === userId && await db.session.count({ where: { userId: user.id } }) === 0) {
            await db.user.delete({ where: { id: user.id } });
          }
        }
        if (ownedConflict) await db.user.delete({ where: { id: ownedConflict } });
      }
      console.log('Temporary verification records cleaned up; existing records preserved.');
    } catch (error) {
      const cleanupFailure = diagnostics.capture(error);
      if (primaryFailure) diagnostics.report(cleanupFailure);
      else { primaryFailure = cleanupFailure; throw cleanupFailure; }
    } finally {
      tokens.clear(); credential = '';
      try { await db.$disconnect(); }
      catch (error) { if (primaryFailure) diagnostics.report(error); else throw diagnostics.capture(error); }
    }
  }
}
main().catch((error: unknown) => { diagnostics.report(error); process.exitCode = 1; });
