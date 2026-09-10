import { createDatabaseClient } from './client.js';

async function inspect() {
  const database = createDatabaseClient();
  try {
    const server = await database.$queryRaw`
      SELECT current_setting('server_version') AS version, current_schema() AS session_schema, to_regnamespace('akgebeya')::text AS application_schema,
             current_setting('transaction_read_only') AS read_only,
             has_schema_privilege(current_user, 'public', 'CREATE') AS can_create
    `;
    const postgis = await database.$queryRaw`
      SELECT name, default_version, installed_version
      FROM pg_available_extensions WHERE name = 'postgis'
    `;
    const tables = await database.$queryRaw`
      SELECT schemaname, tablename FROM pg_tables
      WHERE schemaname IN ('public', 'akgebeya') ORDER BY schemaname, tablename
    `;
    console.log(JSON.stringify({ server, postgis, tables }, null, 2));
  } finally {
    await database.$disconnect();
  }
}

inspect().catch((error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : 'UNKNOWN';
  console.error(`Database inspection failed (${String(code)}). Check connectivity and configuration locally.`);
  process.exitCode = 1;
});
