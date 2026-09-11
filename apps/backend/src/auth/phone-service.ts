import { randomInt, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AuthConfig, PhoneOtpConfig } from '../config.js';
import { HttpError } from '../errors.js';
import { AuthService } from './service.js';
import { phoneSchema, otpSchema } from './phone-input.js';
import { hashOtp, matchesOtp } from './phone-hash.js';
import type { OtpTransport, PhoneOtpRepository } from './phone-types.js';

export class PhoneOtpService {
  constructor(private readonly repository: PhoneOtpRepository, private readonly transport: OtpTransport,
    private readonly config: PhoneOtpConfig, private readonly authConfig: AuthConfig,
    private readonly now: () => Date = () => new Date()) {}

  private secret() {
    if (!this.transport.available || !this.config.secret) throw new HttpError('SERVICE_UNAVAILABLE');
    return this.config.secret;
  }

  async request(input: string) {
    const parsed = phoneSchema.safeParse(input);
    if (!parsed.success) throw new HttpError('BAD_REQUEST');
    const phone = parsed.data;
    const secret = this.secret();
    return this.repository.withPhone(phone, async store => {
      const current = await store.current();
      const now = this.now();
      if (current && current.resendAvailableAt > now) throw new HttpError('TOO_MANY_REQUESTS');
      const id = randomUUID();
      const otp = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = new Date(now.getTime() + this.config.ttlSeconds * 1000);
      const resendAvailableAt = new Date(now.getTime() + this.config.cooldownSeconds * 1000);
      await store.replace({ id, phone, otpHash: hashOtp(secret, id, phone, otp), expiresAt, resendAvailableAt,
        attemptCount: 0, consumedAt: null, revokedAt: null, createdAt: now, updatedAt: now });
      // Only the private test transport exists in Step 4.3. Delivery failure rolls back.
      await this.transport.send({ phone, challengeId: id, otp, expiresAt: expiresAt.toISOString() });
      return { challengeId: id, expiresAt, resendAvailableAt };
    });
  }

  async verify(input: { phone: string; challengeId: string; otp: string }) {
    const parsed = z.object({ phone: phoneSchema, challengeId: z.string().uuid(), otp: otpSchema }).strict().safeParse(input);
    if (!parsed.success) throw new HttpError('BAD_REQUEST');
    const secret = this.secret();
    const { phone, challengeId, otp } = parsed.data;
    const result = await this.repository.withPhone(phone, async store => {
      const current = await store.current();
      const now = this.now();
      if (!current || current.id !== challengeId || current.expiresAt <= now
        || current.consumedAt || current.revokedAt || current.attemptCount >= this.config.maxAttempts) return null;
      if (!matchesOtp(current.otpHash, hashOtp(secret, challengeId, phone, otp))) {
        const attemptCount = current.attemptCount + 1;
        await store.update(current.id, { attemptCount, updatedAt: now,
          revokedAt: attemptCount >= this.config.maxAttempts ? now : null });
        // Return instead of throwing so the failed attempt commits.
        return null;
      }
      await store.update(current.id, { consumedAt: now, updatedAt: now });
      const user = await store.resolveUser('AkGebeya user');
      try {
        // Existing session issuance uses this same transaction: consume and session commit together.
        return await new AuthService(store.authRepository, this.authConfig, this.now).createSessionForVerifiedUser(user.id);
      } catch (error) {
        if (error instanceof HttpError && error.code === 'UNAUTHORIZED') return null;
        throw error;
      }
    });
    if (!result) throw new HttpError('UNAUTHORIZED');
    return result;
  }
}
