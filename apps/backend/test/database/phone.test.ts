import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { decodeJwt } from 'jose';
import { createDatabaseClient } from '../../src/database.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { parseAuthConfig } from '../../src/config.js';
import { PhoneOtpService } from '../../src/auth/phone-service.js';
import { PrismaPhoneOtpRepository } from '../../src/auth/phone-repository.js';
import { hashOtp } from '../../src/auth/phone-hash.js';
import { hashSessionIdentifier } from '../../src/auth/tokens.js';
import { HttpError } from '../../src/errors.js';
import { CaptureOtpTransport, phoneConfig, wrongOtp } from '../phone-fixture.js';

const randomPhone = () => '+2519' + randomInt(0, 100_000_000).toString().padStart(8, '0');
const denied = (error: unknown) => error instanceof HttpError && error.code === 'UNAUTHORIZED';

test('Neon PhoneOtp columns, unique/active/expiry indexes and seven validated constraints enforce storage', async () => {
  const db = createDatabaseClient();
  const phone = randomPhone();
  const rollback = new Error('ROLLBACK_FIXTURE');
  try {
    const columns = await db.$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
       WHERE table_schema = 'akgebeya' AND table_name = 'phone_otps'`;
    assert.equal(columns.length, 10);
    const expected: Record<string, string> = { id: 'uuid', phone: 'character varying', otpHash: 'character',
      attemptCount: 'integer', expiresAt: 'timestamp with time zone', resendAvailableAt: 'timestamp with time zone',
      consumedAt: 'timestamp with time zone', revokedAt: 'timestamp with time zone',
      createdAt: 'timestamp with time zone', updatedAt: 'timestamp with time zone' };
    // There are ten columns: check exact keys, not just selected fields.
    assert.deepEqual(columns.map(c => c.column_name).sort(), Object.keys(expected).sort());
    for (const column of columns) {
      assert.equal(column.data_type, expected[column.column_name]);
      assert.equal(column.is_nullable, ['consumedAt', 'revokedAt'].includes(column.column_name) ? 'YES' : 'NO');
    }
    const indexes = await db.$queryRaw<{ indexname: string; indexdef: string }[]>
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'akgebeya' AND tablename = 'phone_otps'`;
    assert.deepEqual(indexes.map(i => i.indexname).sort(), ['phone_otps_pkey', 'phone_otps_phone_key',
      'phone_otps_expiresAt_idx', 'phone_otps_consumedAt_revokedAt_expiresAt_idx'].sort());
    assert.ok(indexes.find(i => i.indexname === 'phone_otps_phone_key')?.indexdef.includes('UNIQUE'));
    const checks = await db.$queryRaw<{ conname: string; convalidated: boolean }[]>
      `SELECT conname, convalidated FROM pg_constraint WHERE connamespace = 'akgebeya'::regnamespace
       AND conrelid = 'akgebeya.phone_otps'::regclass AND contype = 'c'`;
    assert.equal(checks.length, 7); assert.ok(checks.every(c => c.convalidated));
    try {
      await db.$transaction(async tx => {
        const now = new Date();
        const row = await tx.phoneOtp.create({ data: { phone, otpHash: randomBytes(32).toString('hex'),
          createdAt: now, expiresAt: new Date(now.getTime() + 300_000), resendAvailableAt: new Date(now.getTime() + 60_000) } });
        async function rejects(sql: Prisma.Sql, state: string) {
          await tx.$executeRawUnsafe('SAVEPOINT invalid_write');
          try {
            await assert.rejects(() => tx.$executeRaw(sql), (error: unknown) =>
              error instanceof Prisma.PrismaClientKnownRequestError && error.meta?.code === state);
          } finally { await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_write'); }
        }
        await rejects(Prisma.sql`UPDATE akgebeya.phone_otps SET phone = '0912345678' WHERE id = ${row.id}::uuid`, '23514');
        await rejects(Prisma.sql`UPDATE akgebeya.phone_otps SET "otpHash" = 'plaintext' WHERE id = ${row.id}::uuid`, '23514');
        await rejects(Prisma.sql`UPDATE akgebeya.phone_otps SET "attemptCount" = -1 WHERE id = ${row.id}::uuid`, '23514');
        await rejects(Prisma.sql`UPDATE akgebeya.phone_otps SET "expiresAt" = "createdAt" WHERE id = ${row.id}::uuid`, '23514');
        await rejects(Prisma.sql`UPDATE akgebeya.phone_otps SET "resendAvailableAt" = "createdAt" - interval '1 second' WHERE id = ${row.id}::uuid`, '23514');
        await rejects(Prisma.sql`UPDATE akgebeya.phone_otps SET "resendAvailableAt" = "expiresAt" + interval '1 second' WHERE id = ${row.id}::uuid`, '23514');
        await rejects(Prisma.sql`UPDATE akgebeya.phone_otps SET "consumedAt" = "createdAt" - interval '1 second' WHERE id = ${row.id}::uuid`, '23514');
        await rejects(Prisma.sql`UPDATE akgebeya.phone_otps SET "revokedAt" = "createdAt" - interval '1 second' WHERE id = ${row.id}::uuid`, '23514');
        await rejects(Prisma.sql`INSERT INTO akgebeya.phone_otps (phone, "otpHash", "expiresAt", "resendAvailableAt")
          VALUES (${phone}, ${row.otpHash}, now() + interval '5 minutes', now() + interval '1 minute')`, '23505');
        throw rollback;
      }, { timeout: 60_000 });
    } catch (error) { if (error !== rollback) throw error; }
  } finally { await db.$disconnect(); }
});

test('Neon serializes OTP requests/attempts, consumes exactly once with session, preserves repeat user, and rolls back failures', async () => {
  const db = createDatabaseClient('pooled');
  const phone = randomPhone();
  let owned = false;
  try {
    assert.equal(await db.user.count({ where: { phone } }), 0);
    assert.equal(await db.phoneOtp.count({ where: { phone } }), 0);
    owned = true;
    let now = new Date();
    const clock = () => now;
    const advance = (seconds: number) => { now = new Date(now.getTime() + seconds * 1000); };
    const config = phoneConfig();
    const transport = new CaptureOtpTransport();
    const repository = new PrismaPhoneOtpRepository(db);
    const authConfig = parseAuthConfig({ AUTH_JWT_SECRET: randomBytes(32).toString('base64url') });
    const service = new PhoneOtpService(repository, transport, config, authConfig, clock);
    const requests = await Promise.allSettled(Array.from({ length: 6 }, () => service.request(phone)));
    assert.equal(requests.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(requests.filter(r => r.status === 'rejected').every(r =>
      r.reason instanceof HttpError && r.reason.code === 'TOO_MANY_REQUESTS'));
    assert.equal(transport.deliveries.length, 1);
    assert.equal(await db.user.count({ where: { phone } }), 0);
    let delivery = transport.latest();
    let row = await db.phoneOtp.findUniqueOrThrow({ where: { phone } });
    assert.ok(row.otpHash === hashOtp(config.secret!, row.id, phone, delivery.otp));
    assert.equal(row.expiresAt.getTime(), row.createdAt.getTime() + config.ttlSeconds * 1000);
    const failures = await Promise.allSettled(Array.from({ length: 9 }, () => service.verify({
      phone, challengeId: delivery.challengeId, otp: wrongOtp(delivery.otp),
    })));
    assert.ok(failures.every(r => r.status === 'rejected' && denied(r.reason)),
      'Concurrent verification outcomes: ' + failures.map(r => r.status === 'fulfilled' ? 'fulfilled'
        : r.reason instanceof HttpError ? r.reason.code
        : r.reason instanceof Prisma.PrismaClientKnownRequestError ? r.reason.code + '/' + String(r.reason.meta?.code)
        : 'unknown').join(', '));
    row = await db.phoneOtp.findUniqueOrThrow({ where: { phone } });
    assert.equal(row.attemptCount, config.maxAttempts); assert.ok(row.revokedAt);
    await assert.rejects(() => service.verify({ phone, challengeId: delivery.challengeId, otp: delivery.otp }), denied);
    advance(config.cooldownSeconds);
    await service.request(phone);
    const old = delivery; delivery = transport.latest();
    await assert.rejects(() => service.verify({ phone, challengeId: old.challengeId, otp: old.otp }), denied);
    const successes = await Promise.allSettled(Array.from({ length: 6 }, () => service.verify({
      phone, challengeId: delivery.challengeId, otp: delivery.otp,
    })));
    const success = successes.find(r => r.status === 'fulfilled');
    assert.ok(success?.status === 'fulfilled');
    assert.equal(successes.filter(r => r.status === 'fulfilled').length, 1);
    assert.ok(successes.filter(r => r.status === 'rejected').every(r => denied(r.reason)));
    const user = await db.user.findUniqueOrThrow({ where: { phone } });
    assert.equal(user.phone, phone); assert.equal(user.role, 'USER'); assert.equal(user.telegramId, null);
    const rows = await db.session.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1);
    const jti = String(decodeJwt(success.value.token).jti);
    assert.ok(rows[0]?.tokenHash === hashSessionIdentifier(jti));
    assert.ok(!JSON.stringify(rows).includes(jti) && !JSON.stringify(rows).includes(success.value.token));
    assert.ok((await db.phoneOtp.findUniqueOrThrow({ where: { phone } })).consumedAt);
    advance(config.cooldownSeconds);
    await service.request(phone); delivery = transport.latest();
    const second = await service.verify({ phone, challengeId: delivery.challengeId, otp: delivery.otp });
    assert.equal(decodeJwt(second.token).sub, user.id);
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { phone } }), user);
    advance(config.cooldownSeconds);
    await service.request(phone); delivery = transport.latest();
    advance(config.ttlSeconds);
    await assert.rejects(() => service.verify({ phone, challengeId: delivery.challengeId, otp: delivery.otp }), denied);
    await service.request(phone); delivery = transport.latest();
    const failing = new PhoneOtpService({ withPhone: (number, run) => repository.withPhone(number, store => {
      store.authRepository.createSession = async () => { throw new Error('Injected persistence failure'); };
      return run(store);
    }) }, transport, config, authConfig, clock);
    await assert.rejects(() => failing.verify({ phone, challengeId: delivery.challengeId, otp: delivery.otp }));
    assert.equal((await db.phoneOtp.findUniqueOrThrow({ where: { phone } })).consumedAt, null);
    await service.verify({ phone, challengeId: delivery.challengeId, otp: delivery.otp });
    advance(config.cooldownSeconds);
    const previous = await db.phoneOtp.findUniqueOrThrow({ where: { phone } });
    const brokenTransport = new PhoneOtpService(repository, { available: true, async send() { throw new Error('Transport failure'); } },
      config, authConfig, clock);
    await assert.rejects(() => brokenTransport.request(phone));
    assert.deepEqual(await db.phoneOtp.findUniqueOrThrow({ where: { phone } }), previous);
    await db.user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
    await service.request(phone); delivery = transport.latest();
    await assert.rejects(() => service.verify({ phone, challengeId: delivery.challengeId, otp: delivery.otp }), denied);
    assert.ok((await db.phoneOtp.findUniqueOrThrow({ where: { phone } })).consumedAt);
    assert.equal(await db.session.count({ where: { userId: user.id } }), 3);
  } finally {
    try {
      if (owned) {
        await db.phoneOtp.deleteMany({ where: { phone } });
        const user = await db.user.findUnique({ where: { phone }, select: { id: true } });
        if (user) {
          await db.user.delete({ where: { id: user.id } });
          assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
        }
        assert.equal(await db.phoneOtp.count({ where: { phone } }), 0);
      }
    } finally { await db.$disconnect(); }
  }
});
