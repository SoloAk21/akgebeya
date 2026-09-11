import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

const originSchema = z.string().url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol)
    && url.username === '' && url.password === ''
    && url.pathname === '/' && url.search === '' && url.hash === '';
}, 'Expected an HTTP(S) origin without credentials, path, query, or fragment')
  .transform((value) => new URL(value).origin);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  CORS_ORIGINS: z.string().default('')
    .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(originSchema)),
});

export function parseConfig(environment: NodeJS.ProcessEnv) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }
  return Object.freeze({
    nodeEnv: result.data.NODE_ENV,
    host: result.data.HOST,
    port: result.data.PORT,
    corsOrigins: Object.freeze(result.data.CORS_ORIGINS),
    apiPrefix: '/api/v1' as const,
  });
}

export type AppConfig = ReturnType<typeof parseConfig>;

export function loadEnvironment() {
  loadDotenv({ path: new URL('../.env', import.meta.url), quiet: true });
}

export function loadConfig(): AppConfig {
  loadEnvironment();
  return parseConfig(process.env);
}

const authEnvironmentSchema = z.object({
  AUTH_JWT_SECRET: z.string().min(43).max(172).regex(/^[A-Za-z0-9_-]+$/)
    .refine(value => Buffer.from(value, 'base64url').length >= 32 && Buffer.from(value, 'base64url').toString('base64url') === value),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
});

export function parseAuthConfig(environment: NodeJS.ProcessEnv) {
  const result = authEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(issue => issue.path[0]))];
    throw new Error('Invalid authentication configuration: ' + fields.join(', '));
  }
  return { secret: new Uint8Array(Buffer.from(result.data.AUTH_JWT_SECRET, 'base64url')),
    sessionTtlSeconds: result.data.AUTH_SESSION_TTL_SECONDS, issuer: 'akgebeya', audience: 'akgebeya-api' };
}
export type AuthConfig = ReturnType<typeof parseAuthConfig>;
export function loadAuthConfig(): AuthConfig {
  loadEnvironment();
  return parseAuthConfig(process.env);
}

const telegramEnvironmentSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().regex(/^[0-9]+:[A-Za-z0-9_-]{30,}$/),
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
});
export function parseTelegramConfig(environment: NodeJS.ProcessEnv) {
  const result = telegramEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(issue => issue.path[0]))];
    throw new Error('Invalid Telegram configuration: ' + fields.join(', '));
  }
  return { botToken: result.data.TELEGRAM_BOT_TOKEN, maxAgeSeconds: result.data.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS };
}
export type TelegramConfig = ReturnType<typeof parseTelegramConfig>;
export function loadTelegramConfig(): TelegramConfig {
  loadEnvironment();
  return parseTelegramConfig(process.env);
}

const phoneOtpEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PHONE_OTP_TRANSPORT: z.enum(['disabled', 'test-ipc']).default('disabled'),
  PHONE_OTP_HASH_SECRET: z.string().optional(),
  PHONE_OTP_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(300),
  PHONE_OTP_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  PHONE_OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
}).superRefine((value, context) => {
  if (value.PHONE_OTP_COOLDOWN_SECONDS > value.PHONE_OTP_TTL_SECONDS) {
    context.addIssue({ code: 'custom', path: ['PHONE_OTP_COOLDOWN_SECONDS'], message: 'Cooldown exceeds TTL' });
  }
  if (value.PHONE_OTP_TRANSPORT === 'test-ipc') {
    if (value.NODE_ENV === 'production') {
      context.addIssue({ code: 'custom', path: ['PHONE_OTP_TRANSPORT'], message: 'Test transport forbidden in production' });
    }
    const key = value.PHONE_OTP_HASH_SECRET ?? '';
    if (!/^[A-Za-z0-9_-]{43,172}$/.test(key) || Buffer.from(key, 'base64url').length < 32
      || Buffer.from(key, 'base64url').toString('base64url') !== key) {
      context.addIssue({ code: 'custom', path: ['PHONE_OTP_HASH_SECRET'], message: 'Invalid hash secret' });
    }
  }
});
export function parsePhoneOtpConfig(environment: NodeJS.ProcessEnv) {
  const result = phoneOtpEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(issue => issue.path[0]))];
    throw new Error('Invalid phone OTP configuration: ' + fields.join(', '));
  }
  const value = result.data;
  return { transport: value.PHONE_OTP_TRANSPORT,
    secret: value.PHONE_OTP_TRANSPORT === 'disabled' ? undefined : new Uint8Array(Buffer.from(value.PHONE_OTP_HASH_SECRET!, 'base64url')),
    ttlSeconds: value.PHONE_OTP_TTL_SECONDS, cooldownSeconds: value.PHONE_OTP_COOLDOWN_SECONDS,
    maxAttempts: value.PHONE_OTP_MAX_ATTEMPTS };
}
export type PhoneOtpConfig = ReturnType<typeof parsePhoneOtpConfig>;
export function loadPhoneOtpConfig(): PhoneOtpConfig {
  loadEnvironment();
  return parsePhoneOtpConfig(process.env);
}

const googleEnvironmentSchema = z.object({ GOOGLE_CLIENT_ID: z.string().regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/).optional() });
export function parseGoogleConfig(environment: NodeJS.ProcessEnv) {
  const result = googleEnvironmentSchema.safeParse(environment);
  if (!result.success) throw new Error("Invalid Google configuration: GOOGLE_CLIENT_ID");
  return { clientId: result.data.GOOGLE_CLIENT_ID };
}
export type GoogleConfig = ReturnType<typeof parseGoogleConfig>;
export function loadGoogleConfig(): GoogleConfig { loadEnvironment(); return parseGoogleConfig(process.env); }

const providerEnvironmentSchema = z.object({
  PROVIDER_PENDING_TTL_SECONDS: z.coerce.number().int().min(60).max(2_592_000).default(604_800),
  PROVIDER_APPROVAL_TTL_SECONDS: z.coerce.number().int().min(60).max(31_536_000).default(7_776_000),
});
export function parseProviderConfig(environment: NodeJS.ProcessEnv) {
  const result = providerEnvironmentSchema.safeParse(environment);
  if (!result.success) throw new Error('Invalid provider verification configuration');
  return { pendingTtlSeconds: result.data.PROVIDER_PENDING_TTL_SECONDS, approvalTtlSeconds: result.data.PROVIDER_APPROVAL_TTL_SECONDS };
}
export type ProviderConfig = ReturnType<typeof parseProviderConfig>;
export function loadProviderConfig(): ProviderConfig { loadEnvironment(); return parseProviderConfig(process.env); }
