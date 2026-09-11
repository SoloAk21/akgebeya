import { createHmac, timingSafeEqual } from 'node:crypto';

export function hashOtp(secret: Uint8Array, id: string, phone: string, otp: string) {
  return createHmac('sha256', secret).update(JSON.stringify(['phone-otp-v1', id, phone, otp])).digest('hex');
}
export function matchesOtp(expected: string, actual: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || !/^[a-f0-9]{64}$/.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
