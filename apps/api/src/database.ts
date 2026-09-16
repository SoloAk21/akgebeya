import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from './generated/prisma/client.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

let client: PrismaClient | undefined;

export function getDatabase(): PrismaClient {
  if (client) return client;
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('Database is not configured');
  const adapter = new PrismaPg({
    connectionString, max: 5, connectionTimeoutMillis: 5000,
    query_timeout: 5000, statement_timeout: 5000,
  }, { schema: 'akgebeya_foundation' });
  client = new PrismaClient({ adapter, log: [] });
  return client;
}

export async function inspectPostgis(database: PrismaClient) {
  const [extension] = await database.$queryRaw<Array<{ schema: string }>>`
    SELECT n.nspname AS schema FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'postgis'`;
  if (!extension) throw new Error('PostGIS is not installed');
  // PostgreSQL identifiers cannot be bound parameters. Quote the catalog-derived name.
  const namespace = Prisma.raw(`"${extension.schema.replaceAll('"', '""')}"`);
  const [result] = await database.$queryRaw<Array<{ version: string; srid: number; longitude: number }>>`
    SELECT ${namespace}.PostGIS_Version() AS version,
      ${namespace}.ST_SRID(${namespace}.ST_SetSRID(${namespace}.ST_MakePoint(38.7578, 8.9806), 4326)) AS srid,
      ${namespace}.ST_X(${namespace}.ST_MakePoint(38.7578, 8.9806)) AS longitude`;
  if (!result || result.srid !== 4326 || result.longitude !== 38.7578) throw new Error('PostGIS check failed');
  return result;
}

export async function checkDatabase(): Promise<void> {
  const database = getDatabase();
  await inspectPostgis(database);
  // A successful socket connection alone does not prove the migration was applied.
  await database.foundationProbe.count();
}

export async function disconnectDatabase(): Promise<void> {
  await client?.$disconnect();
  client = undefined;
}
