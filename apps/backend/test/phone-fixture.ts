import { randomBytes, randomUUID } from 'node:crypto';
import { parsePhoneOtpConfig } from '../src/config.js';
import { PhoneOtpService } from '../src/auth/phone-service.js';
import type { OtpDelivery, OtpTransport, PhoneChallenge, PhoneOtpRepository } from '../src/auth/phone-types.js';
import { createAuthFixture } from './auth-fixture.js';

export function phoneConfig() {
  return parsePhoneOtpConfig({ NODE_ENV: 'test', PHONE_OTP_TRANSPORT: 'test-ipc',
    PHONE_OTP_HASH_SECRET: randomBytes(32).toString('base64url') });
}
export class CaptureOtpTransport implements OtpTransport {
  available = true;
  deliveries: OtpDelivery[] = [];
  async send(delivery: OtpDelivery) { this.deliveries.push(delivery); }
  latest() {
    const delivery = this.deliveries.at(-1);
    if (!delivery) throw new Error('Missing test delivery');
    return delivery;
  }
}
export function wrongOtp(otp: string) { return String((Number(otp[0]) + 1) % 10) + otp.slice(1); }

export function createPhoneFixture() {
  const auth = createAuthFixture();
  const config = phoneConfig();
  const transport = new CaptureOtpTransport();
  let challenge: PhoneChallenge | null = null;
  const repository: PhoneOtpRepository = { async withPhone(phone, run) {
    return run({
      authRepository: auth.repository,
      async current() { return challenge; },
      async replace(value) { challenge = value; },
      async update(_id, data) { if (challenge) Object.assign(challenge, data); },
      async resolveUser(displayName) {
        const existing = [...auth.repository.users.values()].find(user => user.phone === phone);
        if (existing) return existing;
        const user = { ...auth.user, id: randomUUID(), phone, email: null, displayName };
        auth.repository.users.set(user.id, user);
        return user;
      },
    });
  } };
  const service = new PhoneOtpService(repository, transport, config, auth.config, auth.getNow);
  return { auth, config, transport, service, challenge: () => challenge,
    advance: (seconds: number) => auth.setNow(new Date(auth.getNow().getTime() + seconds * 1000)) };
}
