import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { decodeJwt } from 'jose';
import { createDatabaseClient } from '../../src/database.js';
import { parseAuthConfig, parseConfig } from '../../src/config.js';
import { PrismaGoogleRepository } from '../../src/auth/google-repository.js';
import { GoogleAuthService } from '../../src/auth/google-service.js';
import { AuthService } from '../../src/auth/service.js';
import { PrismaAuthRepository } from '../../src/auth/repository.js';
import { hashSessionIdentifier } from '../../src/auth/tokens.js';
import { createApp } from '../../src/app.js';
import { googleFixture } from '../google-fixture.js';
import { withServer } from '../helpers.js';

test('Neon Google column, unique index and blank check; original identity check unchanged', async () => {
  const db = createDatabaseClient();
  try {
    const columns = await db.$queryRaw<{ data_type: string; is_nullable: string; character_maximum_length: number }[]>
      `SELECT data_type,is_nullable,character_maximum_length FROM information_schema.columns
       WHERE table_schema='akgebeya' AND table_name='users' AND column_name='googleSub'`;
    assert.deepEqual(columns, [{ data_type: 'character varying', is_nullable: 'YES', character_maximum_length: 255 }]);
    const indexes = await db.$queryRaw<{ indexdef: string }[]>
      `SELECT indexdef FROM pg_indexes WHERE schemaname='akgebeya' AND indexname='users_googleSub_key'`;
    assert.match(indexes[0]?.indexdef ?? '', /CREATE UNIQUE INDEX.*\("googleSub"\)/);
    const checks = await db.$queryRaw<{ conname: string; definition: string; convalidated: boolean }[]>
      `SELECT conname,pg_get_constraintdef(oid) AS definition,convalidated FROM pg_constraint
       WHERE connamespace='akgebeya'::regnamespace AND conname IN ('users_google_sub_check','users_identity_check')`;
    assert.equal(checks.length, 2); assert.ok(checks.every(c => c.convalidated));
    const identity = checks.find(c => c.conname === 'users_identity_check')!.definition;
    assert.ok(!identity.includes('googleSub') && identity.includes('telegramId'));
    for (const googleSub of ['', ' ', '\t\n']) {
      await assert.rejects(db.$transaction(tx => tx.user.create({
        data: { googleSub, email: randomUUID() + '@example.com', displayName: 'Constraint fixture' },
      })));
    }
    await assert.rejects(db.$transaction(async tx => {
      const googleSub = randomUUID();
      await tx.user.create({ data: { googleSub, email: randomUUID() + '@example.com', displayName: 'Unique fixture' } });
      await tx.user.create({ data: { googleSub, email: randomUUID() + '@example.com', displayName: 'Unique fixture' } });
    }), { code: 'P2002' });
  } finally { await db.$disconnect(); }
});

test('Neon Google concurrent first login, repeat identity, conflicts, preserved contacts, hashed sessions and logout', async () => {
  const db = createDatabaseClient();
  const f = await googleFixture();
  const ownedIds: string[] = [];
  const config = parseAuthConfig({ AUTH_JWT_SECRET: randomBytes(32).toString('base64url') });
  const auth = new AuthService(new PrismaAuthRepository(db), config);
  const service = new GoogleAuthService(f.verifier, new PrismaGoogleRepository(db), config);
  try {
    assert.equal(await db.user.count({ where: { OR: [{ googleSub: f.sub }, { email: f.email }] } }), 0);
    const token = await f.sign();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => service.login(token)));
    assert.ok(results.every(result => result.status === 'fulfilled'));
    const sessions = results.map(result => { if (result.status !== 'fulfilled') throw new Error('Concurrent login failed'); return result.value; });
    const user = await db.user.findUniqueOrThrow({ where: { googleSub: f.sub } });
    ownedIds.push(user.id);
    assert.equal(user.email, f.email); assert.equal(user.role, 'USER');
    assert.equal(await db.user.count({ where: { googleSub: f.sub } }), 1);
    assert.equal(await db.session.count({ where: { userId: user.id } }), 5);
    for (const issued of sessions) {
      const jti = String(decodeJwt(issued.token).jti);
      const stored = await db.session.findUniqueOrThrow({ where: { tokenHash: hashSessionIdentifier(jti) } });
      assert.equal(stored.userId, user.id); assert.equal(stored.expiresAt.toISOString(), issued.expiresAt.toISOString());
      assert.ok(stored.tokenHash !== jti && stored.tokenHash !== issued.token);
      assert.ok(!JSON.stringify(stored).includes(token));
    }
    const contactUser = await db.user.create({ data: { email: randomUUID() + '@example.com',
      phone: '+2519' + randomInt(10_000_000, 99_999_999), telegramId: BigInt(randomInt(2 ** 40, 2 ** 41)),
      displayName: 'Preserved contact fixture' } });
    ownedIds.push(contactUser.id);
    const contactBefore = JSON.stringify(contactUser, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v);
    for (const sub of [randomUUID(), f.sub]) {
      await assert.rejects(service.login(await f.sign({ sub, email: contactUser.email })), { code: 'ACCOUNT_LINKING_CONFLICT' });
    }
    const after = await db.user.findUniqueOrThrow({ where: { id: contactUser.id } });
    assert.equal(JSON.stringify(after, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v), contactBefore);
    assert.equal(await db.session.count({ where: { userId: contactUser.id } }), 0);
    // A verified subject with a changed nonconflicting email keeps the exact local user/profile.
    await service.login(await f.sign({ email: randomUUID() + '@example.com' }));
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: user.id } }), user);
    await db.user.update({ where: { id: user.id }, data: { phone: '+2517' + randomInt(10_000_000, 99_999_999),
      telegramId: BigInt(randomInt(2 ** 40, 2 ** 41)) } });
    const contacts = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    await service.login(token);
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: user.id } }), contacts);
    await withServer(createApp(parseConfig({ NODE_ENV: 'test' }), auth, undefined, undefined, service), async base => {
      const conflict = await fetch(base + '/api/v1/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: await f.sign({ sub: randomUUID(), email: contactUser.email }) }) });
      assert.equal(conflict.status, 409);
      assert.deepEqual(await conflict.json(), { error: { code: 'ACCOUNT_LINKING_CONFLICT', message: 'Account linking required' } });
      const headers = { Authorization: 'Bearer ' + sessions[0]!.token };
      assert.equal((await fetch(base + '/api/v1/auth/me', { headers })).status, 200);
      assert.equal((await fetch(base + '/api/v1/auth/logout', { headers, method: 'POST' })).status, 200);
      assert.equal((await fetch(base + '/api/v1/auth/me', { headers })).status, 401);
      const hash = hashSessionIdentifier(String(decodeJwt(sessions[0]!.token).jti));
      assert.ok((await db.session.findUniqueOrThrow({ where: { tokenHash: hash } })).revokedAt);
    });
    await db.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    const count = await db.session.count({ where: { userId: user.id } });
    await assert.rejects(service.login(token), { code: 'UNAUTHORIZED' });
    assert.equal(await db.session.count({ where: { userId: user.id } }), count);
    // Failed session insertion rolls back a new user as well.
    const rollbackSub = randomUUID();
    const repository = new PrismaGoogleRepository(db);
    await assert.rejects(repository.withIdentity({ googleSub: rollbackSub, email: randomUUID() + '@example.com' },
      async () => { throw new Error('Injected session failure'); }));
    assert.equal(await db.user.count({ where: { googleSub: rollbackSub } }), 0);
  } finally {
    const created = await db.user.findUnique({ where: { googleSub: f.sub }, select: { id: true } });
    if (created && !ownedIds.includes(created.id)) ownedIds.push(created.id);
    await db.user.deleteMany({ where: { id: { in: ownedIds } } });
    assert.equal(await db.session.count({ where: { userId: { in: ownedIds } } }), 0);
    await db.$disconnect();
  }
});
