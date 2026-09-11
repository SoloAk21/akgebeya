import assert from 'node:assert/strict';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import { decodeJwt } from 'jose';
import { createDatabaseClient } from '../src/database.js';
import { loadConfig, parseAuthConfig } from '../src/config.js';
import { AuthService } from '../src/auth/service.js';
import { PrismaAuthRepository } from '../src/auth/repository.js';
import { hashOtp } from '../src/auth/phone-hash.js';
import { hashSessionIdentifier } from '../src/auth/tokens.js';
import { normalizedPhoneSchema, otpSchema } from '../src/auth/phone-input.js';
import { withServer } from '../test/helpers.js';
import { withBuiltServer } from './verification-server.js';

const deliverySchema = z.object({ type: z.literal('phone-otp'), phone: normalizedPhoneSchema,
  challengeId: z.string().uuid(), otp: otpSchema, expiresAt: z.string().datetime() });
export async function withPhoneVerification(run: (fixture: {
  base: string; fixtureUrl: string; fixtureKey: string; phone: string;
  delivery: (id: string) => z.infer<typeof deliverySchema>;
  allowResend: () => Promise<void>; expire: () => Promise<void>;
  checkSession: (token: string, expiresAt: string) => Promise<void>;
  checkRevoked: (token: string) => Promise<void>; checkExhausted: () => Promise<void>;
}) => Promise<void>) {
  if (loadConfig().nodeEnv === 'production') throw new Error('Development/test database required');
  const db = createDatabaseClient('pooled');
  const phone = '+2519' + randomInt(0, 100_000_000).toString().padStart(8, '0');
  const secret = randomBytes(32);
  const fixtureKey = randomBytes(32).toString('hex');
  const authKey = randomBytes(32).toString('base64url');
  const auth = new AuthService(new PrismaAuthRepository(db), parseAuthConfig({ AUTH_JWT_SECRET: authKey }));
  const deliveries = new Map<string, z.infer<typeof deliverySchema>>();
  let owned = false;
  let originalUserId: string | undefined;
  const delivery = (id: string) => {
    const value = deliveries.get(id);
    if (!value) throw new Error('Missing private OTP delivery');
    return value;
  };
  const allowResend = async () => {
    const now = Date.now();
    await db.phoneOtp.update({ where: { phone },
      data: { createdAt: new Date(now - 301_000), resendAvailableAt: new Date(now - 300_000) } });
  };
  const expire = async () => {
    const now = Date.now();
    await db.phoneOtp.update({ where: { phone }, data: { createdAt: new Date(now - 301_000),
      expiresAt: new Date(now - 1000), resendAvailableAt: new Date(now - 2000) } });
  };
  const checkSession = async (token: string, expiresAt: string) => {
    const user = await db.user.findUniqueOrThrow({ where: { phone } });
    assert.equal(user.phone, phone); assert.equal(user.role, 'USER');
    assert.equal(user.email, null); assert.equal(user.telegramId, null);
    if (originalUserId) assert.equal(user.id, originalUserId); else originalUserId = user.id;
    assert.equal(await db.user.count({ where: { phone } }), 1);
    assert.equal((await auth.authenticate(token)).user.id, user.id);
    const row = await db.phoneOtp.findUniqueOrThrow({ where: { phone } });
    assert.ok(row.consumedAt && !row.revokedAt);
    assert.ok(row.otpHash === hashOtp(secret, row.id, phone, delivery(row.id).otp));
    assert.equal(row.expiresAt.getTime() - row.createdAt.getTime(), 300_000);
    assert.equal(row.resendAvailableAt.getTime() - row.createdAt.getTime(), 60_000);
    assert.deepEqual(Object.keys(row).sort(), ['id', 'phone', 'otpHash', 'expiresAt', 'resendAvailableAt',
      'attemptCount', 'consumedAt', 'revokedAt', 'createdAt', 'updatedAt'].sort());
    const identifier = String(decodeJwt(token).jti);
    const session = await db.session.findUniqueOrThrow({ where: { tokenHash: hashSessionIdentifier(identifier) } });
    assert.equal(session.userId, user.id); assert.equal(session.expiresAt.toISOString(), expiresAt);
    assert.ok(session.tokenHash !== identifier && session.tokenHash !== token);
    assert.ok(!JSON.stringify(session).includes(token) && !JSON.stringify(session).includes(identifier));
  };
  const checkRevoked = async (token: string) => {
    const row = await db.session.findUniqueOrThrow({ where: { tokenHash: hashSessionIdentifier(String(decodeJwt(token).jti)) } });
    assert.ok(row.revokedAt);
  };
  const checkExhausted = async () => {
    const row = await db.phoneOtp.findUniqueOrThrow({ where: { phone } });
    assert.equal(row.attemptCount, 5); assert.ok(row.revokedAt); assert.equal(row.consumedAt, null);
  };
  try {
    assert.equal(await db.user.count({ where: { phone } }), 0);
    assert.equal(await db.phoneOtp.count({ where: { phone } }), 0);
    owned = true;
    const fixture = express();
    fixture.use(express.json({ limit: '8kb' }));
    fixture.use((request, response, next) => {
      const header = request.get('Authorization') ?? '';
      const expected = 'Bearer ' + fixtureKey;
      if (request.get('Origin') || header.length !== expected.length
        || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
        response.status(403).json({ error: 'Fixture access denied' }); return;
      }
      next();
    });
    fixture.post('/:action', async (request, response) => {
      const body = z.object({ phone: z.literal(phone), challengeId: z.string().uuid().optional(),
        token: z.string().max(4096).optional(), expiresAt: z.string().datetime().optional() }).strict().parse(request.body);
      switch (request.params.action) {
        case 'delivery':
          if (!body.challengeId) throw new Error();
          response.json({ otp: delivery(body.challengeId).otp }); return;
        case 'allow-resend': await allowResend(); break;
        case 'expire': await expire(); break;
        case 'session':
          if (!body.token || !body.expiresAt) throw new Error();
          await checkSession(body.token, body.expiresAt); break;
        case 'revoked':
          if (!body.token) throw new Error();
          await checkRevoked(body.token); break;
        case 'exhausted': await checkExhausted(); break;
        default: response.status(404).json({ error: 'Unknown fixture action' }); return;
      }
      response.json({ status: 'ok' });
    });
    fixture.use((_error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
      response.status(500).json({ error: 'Fixture check failed' });
    });
    await withServer(fixture, fixtureUrl => withBuiltServer({
      NODE_ENV: 'test', AUTH_JWT_SECRET: authKey,
      TELEGRAM_BOT_TOKEN: '123456:' + randomBytes(32).toString('base64url'),
      PHONE_OTP_TRANSPORT: 'test-ipc', PHONE_OTP_HASH_SECRET: secret.toString('base64url'),
      PHONE_OTP_TTL_SECONDS: '300', PHONE_OTP_COOLDOWN_SECONDS: '60', PHONE_OTP_MAX_ATTEMPTS: '5',
    }, base => run({ base, fixtureUrl, fixtureKey, phone, delivery, allowResend, expire, checkSession, checkRevoked, checkExhausted }),
    message => {
      const result = deliverySchema.safeParse(message);
      if (result.success && result.data.phone === phone) deliveries.set(result.data.challengeId, result.data);
    }));
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
        console.log('Neon cleanup passed: temporary phone challenge, user and sessions removed.');
      }
    } finally { deliveries.clear(); await db.$disconnect(); }
  }
}
