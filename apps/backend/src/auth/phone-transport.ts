import type { PhoneOtpConfig } from '../config.js';
import { HttpError } from '../errors.js';
import type { OtpTransport } from './phone-types.js';

export function createOtpTransport(config: PhoneOtpConfig): OtpTransport {
  if (config.transport === 'disabled') {
    return { available: false, async send() { throw new HttpError('SERVICE_UNAVAILABLE'); } };
  }
  // Configuration already forbids test-ipc in production. No HTTP OTP-disclosure route.
  if (!process.send) throw new Error('Test OTP transport requires a private parent IPC channel');
  return { available: true, send: delivery => new Promise<void>((resolve, reject) => {
    process.send!({ type: 'phone-otp', ...delivery }, error => {
      if (error) reject(new HttpError('SERVICE_UNAVAILABLE')); else resolve();
    });
  }) };
}
