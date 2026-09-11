import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { TelegramConfig } from '../config.js';
import { HttpError } from '../errors.js';

const nameSchema = z.string().max(256).regex(/^[^\u0000-\u001f\u007f]*$/);
const userSchema = z.object({
  id: z.number().int().positive().max(2 ** 52 - 1),
  first_name: nameSchema.pipe(z.string().trim().min(1)),
  last_name: nameSchema.optional(),
  language_code: z.string().max(35).optional(),
  is_bot: z.literal(false).optional(),
});
const dateSchema = z.string().regex(/^[0-9]{1,12}$/).transform(Number).pipe(z.number().int().nonnegative());
const inputSchema = z.string().min(1).max(12_000);
export type TelegramIdentity = { telegramId: bigint; displayName: string; preferredLocale: 'en' | 'am' };

export class TelegramVerifier {
  private readonly key: Buffer;
  constructor(private readonly config: TelegramConfig, private readonly now: () => Date = () => new Date()) {
    this.key = createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  }

  verify(raw: string): TelegramIdentity {
    // URLSearchParams alone silently repairs malformed percent encoding.
    if (!inputSchema.safeParse(raw).success) throw new HttpError('UNAUTHORIZED');
    const fields = new Map<string, string>();
    try {
      for (const part of raw.split('&')) {
        const separator = part.indexOf('=');
        if (separator < 1) throw new Error();
        const key = decodeURIComponent(part.slice(0, separator).replaceAll('+', ' '));
        const value = decodeURIComponent(part.slice(separator + 1).replaceAll('+', ' '));
        if (!/^[a-z_]+$/.test(key) || fields.has(key) || /[\r\n]/.test(value)) throw new Error();
        fields.set(key, value);
      }
    } catch { throw new HttpError('UNAUTHORIZED'); }
    const hash = fields.get('hash');
    if (!hash || !/^[0-9a-f]{64}$/.test(hash)) throw new HttpError('UNAUTHORIZED');
    fields.delete('hash');
    // Bot-token validation includes every other field, including signature when present.
    const data = [...fields].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, value]) => key + '=' + value).join('\n');
    const expected = createHmac('sha256', this.key).update(data).digest();
    if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new HttpError('UNAUTHORIZED');
    const date = dateSchema.safeParse(fields.get('auth_date'));
    const now = Math.floor(this.now().getTime() / 1000);
    if (!date.success || date.data > now || now - date.data >= this.config.maxAgeSeconds) {
      throw new HttpError('UNAUTHORIZED');
    }
    // Parse identity only after authenticity and freshness have been established.
    let value: unknown;
    try { value = JSON.parse(fields.get('user') ?? ''); } catch { throw new HttpError('UNAUTHORIZED'); }
    const user = userSchema.safeParse(value);
    if (!user.success) throw new HttpError('UNAUTHORIZED');
    const displayName = Array.from([user.data.first_name, user.data.last_name ?? ''].join(' ').trim()
      .replace(/\s+/g, ' ')).slice(0, 120).join('');
    return { telegramId: BigInt(user.data.id), displayName,
      preferredLocale: user.data.language_code?.toLowerCase().split('-')[0] === 'am' ? 'am' : 'en' };
  }
}
