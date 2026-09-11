import { z } from 'zod';

export const normalizedPhoneSchema = z.string().regex(/^\+251[79][0-9]{8}$/);
export const phoneSchema = z.string().trim().min(1).max(32)
  .regex(/^(?:\+251|0)[79][0-9]{8}$/)
  .transform(value => value.startsWith('0') ? '+251' + value.slice(1) : value)
  .pipe(normalizedPhoneSchema);
export const otpSchema = z.string().regex(/^[0-9]{6}$/);
