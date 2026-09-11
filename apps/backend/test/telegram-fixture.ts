import { createHmac, randomBytes } from 'node:crypto';
import { parseTelegramConfig } from '../src/config.js';

// Ephemeral test credentials; never a real Telegram bot token.
export function telegramConfig() {
  return parseTelegramConfig({ TELEGRAM_BOT_TOKEN: '123456:' + randomBytes(32).toString('base64url') });
}
export function signedInitData(botToken: string, values: Record<string, string>) {
  const params = new URLSearchParams(values);
  const check = Object.keys(values).sort().map(key => key + '=' + values[key]).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return params.toString();
}
export function telegramValues(id = 2 ** 40 + 123, now = new Date()) {
  return { auth_date: String(Math.floor(now.getTime() / 1000)),
    user: JSON.stringify({ id, first_name: 'Telegram', last_name: 'Test', language_code: 'am-ET' }) };
}
