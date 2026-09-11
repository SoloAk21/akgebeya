import assert from 'node:assert/strict';
import { randomBytes, randomInt } from 'node:crypto';
import { test } from 'node:test';
import { decodeJwt } from 'jose';
import { createDatabaseClient } from '../../src/database.js';
import { createApp } from '../../src/app.js';
import { parseAuthConfig, parseConfig } from '../../src/config.js';
import { AuthService } from '../../src/auth/service.js';
import { PrismaAuthRepository } from '../../src/auth/repository.js';
import { TelegramAuthService } from '../../src/auth/telegram-service.js';
import { PrismaTelegramRepository } from '../../src/auth/telegram-repository.js';
import { TelegramVerifier } from '../../src/auth/telegram-verifier.js';
import { hashSessionIdentifier } from '../../src/auth/tokens.js';
import { withServer } from '../helpers.js';
import { signedInitData, telegramConfig, telegramValues } from '../telegram-fixture.js';

test('Neon Telegram identity constraint/index, concurrent repeat login, safe mapping, sessions and cleanup', async () => {
  const db = createDatabaseClient('pooled');
  const telegramId = BigInt(randomInt(2 ** 40, 2 ** 41));
  let fixtureOwned = false;
  let userId: string | undefined;
  try {
    assert.equal(await db.user.count({ where: { telegramId } }), 0);
    const column = await db.$queryRaw<{ data_type: string; is_nullable: string }[]>
      `SELECT data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'akgebeya' AND table_name = 'users' AND column_name = 'telegramId'`;
    assert.deepEqual(column, [{ data_type: 'bigint', is_nullable: 'YES' }]);
    const indexes = await db.$queryRaw<{ indexdef: string }[]>
      `SELECT indexdef FROM pg_indexes WHERE schemaname = 'akgebeya' AND indexname = 'users_telegramId_key'`;
    assert.match(indexes[0]?.indexdef ?? '', /CREATE UNIQUE INDEX.*\("telegramId"\)/);
    const checks = await db.$queryRaw<{ definition: string; validated: boolean }[]>
      `SELECT pg_get_constraintdef(oid) AS definition, convalidated AS validated FROM pg_constraint
       WHERE connamespace = 'akgebeya'::regnamespace AND conname = 'users_identity_check'`;
    assert.ok(checks[0]?.definition.includes('"telegramId"'));
    assert.equal(checks[0]?.validated, true);
    const config = telegramConfig();
    const auth = new AuthService(new PrismaAuthRepository(db),
      parseAuthConfig({ AUTH_JWT_SECRET: randomBytes(32).toString('base64url') }));
    const telegram = new TelegramAuthService(new TelegramVerifier(config), new PrismaTelegramRepository(db), auth);
    const values = telegramValues(Number(telegramId));
    values.user = JSON.stringify({ id: Number(telegramId), first_name: 'Telegram database test', language_code: 'am',
      role: 'ADMIN', email: 'attacker@example.com', userId: 'attacker' });
    const initData = signedInitData(config.botToken, values);
    fixtureOwned = true;
    await withServer(createApp(parseConfig({ NODE_ENV: 'test' }), auth, telegram), async base => {
      const login = (raw = initData) => fetch(base + '/api/v1/auth/telegram', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: raw }),
      });
      const responses = await Promise.all([login(), login(), login()]);
      const tokens: string[] = [];
      for (const response of responses) {
        assert.equal(response.status, 200);
        const body = await response.json() as { token: string; expiresAt: string };
        tokens.push(body.token);
        const user = await db.user.findUniqueOrThrow({ where: { telegramId } });
        userId = user.id;
        assert.equal(user.email, null);
        assert.equal(user.phone, null);
        assert.equal(user.role, 'USER');
        assert.equal(user.preferredLocale, 'am');
        const jti = String(decodeJwt(body.token).jti);
        const session = await db.session.findUniqueOrThrow({ where: { tokenHash: hashSessionIdentifier(jti) } });
        assert.equal(session.userId, userId);
        assert.ok(session.tokenHash !== jti && session.tokenHash !== body.token);
        assert.equal(session.expiresAt.toISOString(), body.expiresAt);
        assert.equal(session.revokedAt, null);
        assert.equal((await auth.authenticate(body.token)).user.id, userId);
      }
      assert.equal(await db.user.count({ where: { telegramId } }), 1);
      assert.equal(await db.session.count({ where: { userId } }), 3);
      await assert.rejects(() => db.user.create({ data: { telegramId, displayName: 'Duplicate' } }),
        (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002');
      await assert.rejects(() => db.user.create({ data: { displayName: 'Missing identity' } }));
      const before = await db.user.update({ where: { id: userId! }, data: { displayName: 'Local profile', preferredLocale: 'en' } });
      const again = await login();
      assert.equal(again.status, 200); await again.arrayBuffer();
      const after = await db.user.findUniqueOrThrow({ where: { telegramId } });
      assert.deepEqual(after, before, 'Repeat login must not overwrite local user data');
      for (const state of [{ status: 'SUSPENDED' as const }, { status: 'DEACTIVATED' as const },
        { status: 'ACTIVE' as const, deletedAt: new Date() }]) {
        await db.user.update({ where: { id: userId! }, data: state });
        const response = await login();
        assert.equal(response.status, 401); await response.arrayBuffer();
      }
      assert.equal(await db.session.count({ where: { userId } }), 4);
      await db.user.update({ where: { id: userId! }, data: { status: 'ACTIVE', deletedAt: null } });
      const logout = await fetch(base + '/api/v1/auth/logout', {
        method: 'POST', headers: { Authorization: 'Bearer ' + tokens[0] },
      });
      assert.equal(logout.status, 200); await logout.arrayBuffer();
      assert.equal(await db.session.count({ where: { userId, revokedAt: { not: null } } }), 1);
      const replay = await fetch(base + '/api/v1/auth/me', { headers: { Authorization: 'Bearer ' + tokens[0] } });
      assert.equal(replay.status, 401); await replay.arrayBuffer();
      for (const raw of ['invalid', signedInitData(config.botToken, { ...values, auth_date: '1' })]) {
        const response = await login(raw);
        assert.equal(response.status, 401); await response.arrayBuffer();
      }
      assert.equal(await db.session.count({ where: { userId } }), 4);
    });
  } finally {
    try {
      if (fixtureOwned) {
        const user = await db.user.findUnique({ where: { telegramId }, select: { id: true } });
        if (user) {
          await db.user.delete({ where: { id: user.id } });
          assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
        }
        assert.equal(await db.user.count({ where: { telegramId } }), 0);
      }
    } finally { await db.$disconnect(); }
  }
});
