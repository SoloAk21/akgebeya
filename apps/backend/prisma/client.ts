import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import { PrismaClient } from '../src/generated/prisma/client.js';

const postgresUrl = z.string().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['postgres:', 'postgresql:'].includes(url.protocol)
    && url.hostname.length > 0 && url.pathname.length > 1
    && (!url.hostname.endsWith('.neon.tech')
      || ['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode') ?? ''));
}, 'Expected a PostgreSQL URL with TLS for Neon');

const databaseSchema = z.object({ DATABASE_URL: postgresUrl, DIRECT_URL: postgresUrl })
  .superRefine((value, context) => {
    if (!URL.canParse(value.DATABASE_URL) || !URL.canParse(value.DIRECT_URL)) return;
    const pooled = new URL(value.DATABASE_URL);
    const direct = new URL(value.DIRECT_URL);
    if (pooled.searchParams.get('schema') !== 'akgebeya' || direct.searchParams.get('schema') !== 'akgebeya') {
      context.addIssue({ code: 'custom', path: ['DATABASE_URL', 'DIRECT_URL'], message: 'Use the akgebeya application schema' });
    }
    if (direct.hostname.endsWith('.neon.tech') && direct.hostname.includes('-pooler.')) {
      context.addIssue({ code: 'custom', path: ['DIRECT_URL'], message: 'Use a direct Neon endpoint' });
    }
    if (pooled.hostname.replace('-pooler.', '.') !== direct.hostname || pooled.pathname !== direct.pathname || (pooled.searchParams.get('schema') ?? 'public') !== (direct.searchParams.get('schema') ?? 'public')) {
      context.addIssue({ code: 'custom', path: ['DIRECT_URL'], message: 'Both URLs must target the same database' });
    }
  });

export function parseDatabaseConfig(environment: NodeJS.ProcessEnv) {
  const result = databaseSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path[0]))];
    throw new Error(`Invalid database configuration: ${fields.join(', ')}`);
  }
  return result.data;
}

// Database tooling only. Importing this module never opens a connection.
export function createDatabaseClient(connection: 'pooled' | 'direct' = 'direct') {
  loadDotenv({ path: new URL('../.env', import.meta.url), quiet: true });
  const config = parseDatabaseConfig(process.env);
  return new PrismaClient({
    datasources: { db: { url: connection === 'direct' ? config.DIRECT_URL : config.DATABASE_URL } },
    errorFormat: 'minimal',
  });
}
