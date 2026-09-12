import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '../src/database.js';
import { loadConfig } from '../src/config.js';
import { Prisma } from '../src/generated/prisma/client.js';

// Keep snapshots in memory; never print records or hashes.
let stage = 'configuration';
async function verifyMigration() {
  if (loadConfig().nodeEnv === 'production') throw new Error('Development verification only');
  const db = createDatabaseClient();
  try {
    stage = 'list tables';
    const tables = await db.$queryRaw<{ schemaname: string; tablename: string }[]>
      `SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'akgebeya')
       AND tablename <> '_prisma_migrations' ORDER BY schemaname, tablename`;
    async function snapshot() {
      const result: string[] = [];
      for (const table of tables) {
        stage = 'snapshot ' + table.schemaname + '.' + table.tablename;
        const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
        const name = Prisma.raw(quote(table.schemaname) + '.' + quote(table.tablename));
        const expression = Prisma.raw('to_jsonb(t)');
        const rows = await db.$queryRaw<{ data: string }[]>
          `SELECT COALESCE(jsonb_agg(${expression} ORDER BY (${expression})::text)::text, '[]') AS data FROM ${name} t`;
        result.push(createHash('sha256').update(rows[0]!.data).digest('hex'));
      }
      const catalog=await db.$queryRaw`SELECT jsonb_build_object(
        'indexes',(SELECT jsonb_agg(row_to_json(i) ORDER BY indexname) FROM pg_indexes i WHERE schemaname='akgebeya'),
        'columns',(SELECT jsonb_agg(row_to_json(c) ORDER BY table_name,ordinal_position) FROM information_schema.columns c WHERE table_schema='akgebeya'),
        'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_constraint WHERE connamespace='akgebeya'::regnamespace AND conname<>'listings_draft_publication_check')
      ) AS data`;
      result.push(createHash('sha256').update(JSON.stringify(catalog)).digest('hex'));
      return result;
    }

    stage = 'snapshot before migration';
    const before = await snapshot();
    const usersBefore = await db.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM akgebeya.users`;
    stage = 'migration deploy';
    const migration = spawnSync(process.execPath, [
      fileURLToPath(new URL('../../../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy',
    ], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env, encoding: 'utf8', windowsHide: true });
    if (migration.status !== 0) console.error('Migration process status: ' + migration.status + '; error codes: ' + (migration.stderr.match(/P[0-9]{4}|MODULE_NOT_FOUND/g) ?? []).join(', '));
    assert.ok(migration.status === 0, 'Migration failed; inspect Prisma migration status locally');
    stage = 'snapshot after migration';
    const after = await snapshot();
    assert.ok(before.every((value, index) => value === after[index]), 'Existing database records changed');
    console.log('Migration applied; all ' + tables.length + ' existing tables preserved, including ' + usersBefore[0]?.count + ' application users.');
  } finally { await db.$disconnect(); }
}
verifyMigration().catch((error: unknown) => { if (error instanceof Prisma.PrismaClientKnownRequestError) console.error('SQLSTATE: ' + String(error.meta?.code)); const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN'; console.error('Migration preservation verification failed at ' + stage + ' (' + (/^[A-Z0-9_]+$/.test(code) ? code : 'UNKNOWN') + '). No records or credentials logged.'); process.exitCode = 1; });
