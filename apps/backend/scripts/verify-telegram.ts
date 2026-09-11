import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { decodeJwt } from 'jose';
import { createDatabaseClient } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { hashSessionIdentifier } from '../src/auth/tokens.js';
import { signedInitData, telegramConfig, telegramValues } from '../test/telegram-fixture.js';
import { withBuiltServer } from './verification-server.js';

async function verify() {
  if (loadConfig().nodeEnv === 'production') throw new Error('Development/test only');
  // Synthetic token exists only in process memory and the isolated child environment.
  const config = telegramConfig();
  const telegramId = BigInt(randomInt(2 ** 40, 2 ** 41));
  const db = createDatabaseClient('pooled');
  let owned = false;
  try {
    assert.equal(await db.user.count({ where: { telegramId } }), 0);
    owned = true;
    await withBuiltServer({ TELEGRAM_BOT_TOKEN: config.botToken }, async base => {
      function curl(path: string, body?: unknown, token?: string) {
        const args = ['--silent', '--show-error', '--max-time', '20', '--write-out', '\n%{http_code}'];
        let input: string | undefined;
        if (body !== undefined) {
          args.push('--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-');
          input = JSON.stringify(body);
        } else if (token) {
          args.push('--header', '@-');
          input = 'Authorization: Bearer ' + token + '\n';
          if (path === 'logout') args.push('--request', 'POST');
        }
        args.push(base + '/' + path);
        const result = spawnSync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
          input, encoding: 'utf8', windowsHide: true,
        });
        assert.ok(result.status === 0, 'curl failed');
        const split = result.stdout.lastIndexOf('\n');
        return { status: Number(result.stdout.slice(split + 1)), body: JSON.parse(result.stdout.slice(0, split)) as Record<string, unknown> };
      }
      const values = telegramValues(Number(telegramId));
      const initData = signedInitData(config.botToken, values);
      for (const body of [{}, { initData: 'invalid' },
        { initData: signedInitData(config.botToken, { ...values, auth_date: '1' }) }]) {
        const response = curl('telegram', body);
        const expected = 'initData' in body ? 401 : 400;
        assert.equal(response.status, expected);
        assert.deepEqual(response.body, { error: { code: expected === 400 ? 'BAD_REQUEST' : 'UNAUTHORIZED',
          message: expected === 400 ? 'Invalid request' : 'Authentication required' } });
        console.log('POST /api/v1/auth/telegram: HTTP ' + expected + ' ' + JSON.stringify(response.body));
      }
      let token = '';
      let userId = '';
      for (let i = 0; i < 2; i++) {
        const response = curl('telegram', { initData });
        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(response.body).sort(), ['expiresAt', 'token']);
        assert.equal(typeof response.body.token, 'string');
        token = String(response.body.token);
        const user = await db.user.findUniqueOrThrow({ where: { telegramId } });
        userId = user.id;
        assert.equal(user.email, null); assert.equal(user.phone, null); assert.equal(user.role, 'USER');
        const jti = String(decodeJwt(token).jti);
        const row = await db.session.findUniqueOrThrow({ where: { tokenHash: hashSessionIdentifier(jti) } });
        assert.equal(row.userId, userId);
        assert.ok(row.tokenHash !== jti && row.tokenHash !== token);
        assert.equal(row.expiresAt.toISOString(), response.body.expiresAt);
        const me = curl('me', undefined, token);
        assert.equal(me.status, 200);
        assert.equal((me.body.user as { id: string }).id, userId);
        console.log('POST /api/v1/auth/telegram: HTTP 200 {"token":"<redacted>","expiresAt":"<ISO timestamp>"}');
      }
      assert.equal(await db.user.count({ where: { telegramId } }), 1);
      assert.equal(await db.session.count({ where: { userId } }), 2);
      const logout = curl('logout', undefined, token);
      assert.equal(logout.status, 200); assert.deepEqual(logout.body, { status: 'ok' });
      assert.equal(await db.session.count({ where: { userId, revokedAt: { not: null } } }), 1);
      assert.equal(curl('me', undefined, token).status, 401);
      console.log('Verified: one Telegram user, two hash-only sessions, authenticated me, logout revocation and HTTP 401 replay.');
    });
  } finally {
    try {
      if (owned) {
        const user = await db.user.findUnique({ where: { telegramId }, select: { id: true } });
        if (user) {
          await db.user.delete({ where: { id: user.id } });
          assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
        }
        assert.equal(await db.user.count({ where: { telegramId } }), 0);
        console.log('Temporary Telegram user and sessions removed.');
      }
    } finally { await db.$disconnect(); }
  }
}
verify().catch(() => { console.error('Telegram verification failed; no credentials or payloads logged.'); process.exitCode = 1; });
