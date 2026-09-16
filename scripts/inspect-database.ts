import { getDatabase, disconnectDatabase } from '../apps/api/src/database.js';

try {
  const database = getDatabase();
  const tables = await database.$queryRaw<Array<{ table_schema: string; table_name: string }>>`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_schema, table_name`;
  const extensions = await database.$queryRaw`SELECT e.extname, e.extversion, n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname`;
  const histories = tables.some(table => table.table_schema === 'akgebeya' && table.table_name === '_prisma_migrations')
    ? await database.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM akgebeya._prisma_migrations ORDER BY started_at`
    : [];
  console.log(JSON.stringify({ tables, extensions, existingMigrationHistory: histories }, null, 2));
} catch {
  console.error('Could not inspect the configured database. Connection details withheld.');
  process.exitCode = 1;
} finally { await disconnectDatabase(); }
