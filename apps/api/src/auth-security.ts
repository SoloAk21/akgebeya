import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export class AuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function credentials(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || !('email' in value) || typeof value.email !== 'string'
    || !('password' in value) || typeof value.password !== 'string'
    || Object.keys(value).some(key => key !== 'email' && key !== 'password')) {
    throw new AuthError(400, 'INVALID_INPUT', 'Enter an email address and password.');
  }
  const email = value.email.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AuthError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  }
  // Do not trim, normalize, or truncate passwords.
  if (value.password.length < 15 || value.password.length > 128 || Buffer.byteLength(value.password) > 512) {
    throw new AuthError(400, 'INVALID_PASSWORD', 'Use a password between 15 and 128 characters.');
  }
  return { email, password: value.password };
}

export function digest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function sessionToken() { return randomBytes(32).toString('hex'); }

let hashing = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  if (hashing >= 2) throw new AuthError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.');
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
        (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { hashing--; }
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string | undefined) {
  // Unknown accounts perform the same expensive derivation; no fast email-existence oracle.
  const parts = encoded?.split('$');
  const valid = parts?.[0] === 'scrypt' && /^[a-f0-9]{32}$/.test(parts[1] ?? '') && /^[a-f0-9]{128}$/.test(parts[2] ?? '');
  const salt = valid ? parts![1]! : '00000000000000000000000000000000';
  const expected = valid ? Buffer.from(parts![2]!, 'hex') : Buffer.alloc(64);
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected) && Boolean(valid);
}

export function tokenFromCookie(cookie: string | undefined, name: string) {
  const matches = (cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const token = matches[0]!.slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}
