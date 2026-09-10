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

export function loadConfig(): AppConfig {
  loadDotenv({ path: new URL('../.env', import.meta.url), quiet: true });
  return parseConfig(process.env);
}
