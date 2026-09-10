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
