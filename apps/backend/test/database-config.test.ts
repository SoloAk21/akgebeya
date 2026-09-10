import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDatabaseConfig } from '../prisma/client.js';

const pooled = 'postgresql://user:secret@ep-example-pooler.eu.neon.tech/neondb?sslmode=require&schema=akgebeya';
const direct = pooled.replace('-pooler.', '.');

test('database configuration accepts matching TLS Neon endpoints and local PostgreSQL', () => {
  assert.equal(parseDatabaseConfig({ DATABASE_URL: pooled, DIRECT_URL: direct }).DIRECT_URL, direct);
  const local = 'postgresql://localhost:5432/akgebeya?schema=akgebeya';
  assert.equal(parseDatabaseConfig({ DATABASE_URL: local, DIRECT_URL: local }).DATABASE_URL, local);
});

test('database configuration rejects missing, invalid, mismatched, pooled-direct, and insecure URLs without leaking credentials', () => {
  for (const environment of [
    {},
    { DATABASE_URL: 'invalid-secret', DIRECT_URL: direct },
    { DATABASE_URL: pooled, DIRECT_URL: pooled },
    { DATABASE_URL: pooled.replace('schema=akgebeya', 'schema=public'), DIRECT_URL: direct },
    { DATABASE_URL: pooled, DIRECT_URL: direct.replace('neondb', 'otherdb') },
    { DATABASE_URL: pooled.replace('sslmode=require', 'sslmode=disable'), DIRECT_URL: direct },
  ]) {
    assert.throws(() => parseDatabaseConfig(environment), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /^Invalid database configuration:/);
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
  }
});
