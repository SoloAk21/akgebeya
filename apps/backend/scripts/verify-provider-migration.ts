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
        const expression = Prisma.raw(table.schemaname === 'akgebeya' && table.tablename === 'providers'
          ? "to_jsonb(t) - 'role'" : 'to_jsonb(t)');
        const rows = await db.$queryRaw<{ data: string }[]>
          `SELECT COALESCE(jsonb_agg(${expression} ORDER BY (${expression})::text)::text, '[]') AS data FROM ${name} t`;
        result.push(createHash('sha256').update(rows[0]!.data).digest('hex'));
      }
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
    const nonNull = await db.$queryRaw<{ count: number }[]>
      `SELECT count(*)::int AS count FROM akgebeya.providers WHERE "role" IS NOT NULL`;
    assert.equal(nonNull[0]?.count, 0);

const enums = await db.$queryRaw<{ typname: string; enumlabel: string }[]>`SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='akgebeya' AND t.typname IN ('ProviderRole','VerificationType')`;
assert.deepEqual(enums.filter(r=>r.typname==='ProviderRole').map(r=>r.enumlabel).sort(), ['AGENCY','AGENT','BROKER','DEVELOPER','OWNER']);
assert.ok(enums.some(r=>r.typname==='VerificationType' && r.enumlabel==='PROVIDER'));
const column = await db.$queryRaw<{is_nullable: string; udt_name: string}[]>`SELECT is_nullable, udt_name FROM information_schema.columns WHERE table_schema='akgebeya' AND table_name='providers' AND column_name='role'`;
assert.equal(column[0]?.is_nullable,'YES'); assert.equal(column[0]?.udt_name,'ProviderRole');
const index = await db.$queryRaw<{indexdef:string}[]>`SELECT indexdef FROM pg_indexes WHERE schemaname='akgebeya' AND indexname='verifications_provider_pending_key'`;
assert.ok(index[0]?.indexdef.includes('UNIQUE') && index[0]?.indexdef.includes('userId') && index[0]?.indexdef.includes('PROVIDER') && index[0]?.indexdef.includes('PENDING'));
const checks = await db.$queryRaw<{conname:string; definition:string}[]>`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='akgebeya'::regnamespace AND conname IN ('verifications_target_check','verifications_provider_review_check') AND convalidated`;
assert.equal(checks.length,2); assert.ok(checks.every(r=>r.definition.includes('PROVIDER')));
const triggers = await db.$queryRaw<{tgname:string}[]>`SELECT tgname FROM pg_trigger WHERE tgname IN ('verifications_provider_owner','providers_preserve_verification_owner') AND tgenabled='O'`;
assert.equal(triggers.length,2);
console.log('Provider enum, nullable role, verification purpose, pending index, constraints and ownership triggers verified.');
    console.log('Migration applied; all ' + tables.length + ' existing tables preserved, including ' + usersBefore[0]?.count + ' application users.');
  } finally { await db.$disconnect(); }
}
verifyMigration().catch((error: unknown) => { if (error instanceof Prisma.PrismaClientKnownRequestError) console.error('SQLSTATE: ' + String(error.meta?.code)); const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN'; console.error('Migration preservation verification failed at ' + stage + ' (' + (/^[A-Z0-9_]+$/.test(code) ? code : 'UNKNOWN') + '). No records or credentials logged.'); process.exitCode = 1; });
