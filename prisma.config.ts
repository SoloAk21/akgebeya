import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const configuredUrl = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
// Keep migration bookkeeping out of any pre-existing application's schema.
const migrationUrl = configuredUrl ? new URL(configuredUrl) : undefined;
migrationUrl?.searchParams.set('schema', 'akgebeya_foundation');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: migrationUrl?.toString() ?? '' },
});
