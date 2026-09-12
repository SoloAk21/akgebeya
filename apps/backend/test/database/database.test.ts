import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { createDatabaseClient } from '../../prisma/client.js';
import { Prisma } from '../../src/generated/prisma/client.js';

const database = createDatabaseClient();
after(async () => { await database.$disconnect(); });
const tables = ['users', 'providers', 'listings', 'locations', 'payments', 'sessions', 'verifications', 'media', 'referrals', 'notifications', 'phone_otps', 'listing_fee_quotes'];

test('Neon contains all application tables, UUID primary keys, timezone timestamps, foreign keys, indexes, and checks', async () => {
  const schema = await database.$queryRaw<{ schema: string }[]>`SELECT to_regnamespace('akgebeya')::text AS schema`;
  assert.equal(schema[0]?.schema, 'akgebeya', 'Database tests must target the isolated application schema');
  const actualTables = await database.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'akgebeya' AND tablename <> '_prisma_migrations'
  `;
  assert.deepEqual(actualTables.map((row) => row.tablename).sort(), [...tables].sort());
  const columns = await database.$queryRaw<{ table_name: string; column_name: string; data_type: string }[]>`
    SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'akgebeya' AND column_name IN ('id', 'createdAt', 'updatedAt')
  `;
  for (const table of tables) {
    for (const [column, type] of [['id', 'uuid'], ['createdAt', 'timestamp with time zone'], ['updatedAt', 'timestamp with time zone']]) {
      if (table === 'listing_fee_quotes' && column === 'updatedAt') continue; // Immutable quote uses calculatedAt/createdAt.
      assert.ok(columns.some((row) => row.table_name === table && row.column_name === column && row.data_type === type), `${table}.${column}`);
    }
  }
  const relations = await database.$queryRaw<{ name: string; target_schema: string }[]>`
    SELECT c.conname AS name, target_ns.nspname AS target_schema
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    JOIN pg_class target ON target.oid = c.confrelid JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
    WHERE n.nspname = 'akgebeya' AND c.contype = 'f'
  `;
  assert.deepEqual(relations.map((row) => row.name).sort(), [
    'listing_fee_quotes_listingId_fkey', 'providers_userId_fkey', 'listings_providerId_fkey', 'listings_locationId_fkey',
    'payments_feeQuoteId_fkey', 'payments_userId_fkey', 'payments_listingId_fkey', 'sessions_userId_fkey',
    'verifications_userId_fkey', 'verifications_reviewerId_fkey', 'media_uploadedById_fkey',
    'media_listingId_fkey', 'media_verificationId_fkey', 'referrals_referrerId_fkey',
    'referrals_referredUserId_fkey', 'notifications_userId_fkey',
  ].sort());
  assert.ok(relations.every((row) => row.target_schema === 'akgebeya'));
  const unindexed = await database.$queryRaw<{ name: string }[]>`
    SELECT c.conname AS name FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'akgebeya' AND c.contype = 'f' AND NOT EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indisvalid AND i.indpred IS NULL AND i.indkey[0] = c.conkey[1]
    )
  `;
  assert.deepEqual(unindexed, [], 'Every foreign key must have a usable leading-column index');
  const indexes = await database.$queryRaw<{ count: number; all_valid: boolean }[]>`
    SELECT count(*)::int AS count, bool_and(i.indisvalid) AS all_valid FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'akgebeya' AND t.relname <> '_prisma_migrations'
  `;
  assert.equal(indexes[0]?.count, 51);
  assert.equal(indexes[0]?.all_valid, true);
  const checks = await database.$queryRaw<{ count: number; all_valid: boolean }[]>`
    SELECT count(*)::int AS count, bool_and(c.convalidated) AS all_valid
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'akgebeya' AND c.contype = 'c'
  `;
  assert.equal(checks[0]?.count, 41);
  assert.equal(checks[0]?.all_valid, true);
});

test('PostGIS extension, WGS84 geography point, and GiST spatial index exist', async () => {
  const extensions = await database.$queryRaw<{ extversion: string; schema: string }[]>`
    SELECT e.extversion, n.nspname AS schema FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'postgis'
  `;
  assert.equal(extensions.length, 1);
  assert.equal(extensions[0]?.schema, 'public');
  const spatial = await database.$queryRaw<{ type: string; srid: number }[]>`
    SELECT public.postgis_typmod_type(a.atttypmod) AS type, public.postgis_typmod_srid(a.atttypmod) AS srid
    FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'akgebeya' AND c.relname = 'locations' AND a.attname = 'coordinates'
  `;
  assert.deepEqual(spatial, [{ type: 'Point', srid: 4326 }]);
  const indexes = await database.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes WHERE schemaname = 'akgebeya' AND indexname = 'locations_coordinates_idx'
  `;
  assert.match(indexes[0]?.indexdef ?? '', /USING gist \(coordinates\)/);
});

test('pooled Neon connection reaches the same migrated application schema', async () => {
  const pooled = createDatabaseClient('pooled');
  try {
    const result = await pooled.$queryRaw<{ schema: string; version: string }[]>`
      SELECT 'akgebeya' AS schema, public.postgis_version() AS version
    `;
    assert.equal(result[0]?.schema, 'akgebeya');
    assert.ok(result[0]?.version);
    await pooled.user.count();
  } finally { await pooled.$disconnect(); }
});

test('all ten models support related records; database rejects invalid writes; fixtures roll back', async () => {
  const marker = randomUUID();
  const rollback = new Error('ROLLBACK_TEST_FIXTURES');
  try {
    await database.$transaction(async (tx) => {
      const owner = await tx.user.create({ data: { email: `${marker}@example.com`, displayName: 'Database test' } });
      const buyer = await tx.user.create({ data: { email: `buyer-${marker}@example.com`, displayName: 'Buyer' } });
      const provider = await tx.provider.create({ data: { userId: owner.id, nameEn: 'Test provider', nameAm: 'አቅራቢ' } });
      const location = await tx.location.create({ data: { regionEn: 'Addis Ababa', cityEn: 'Addis Ababa', cityAm: 'አዲስ አበባ' } });
      const listing = await tx.listing.create({ data: {
        providerId: provider.id, locationId: location.id, titleEn: 'Test home', titleAm: 'ቤት',
        descriptionEn: 'Database fixture', category: 'RESIDENTIAL', type: 'RENT', propertyType: 'APARTMENT', price: new Prisma.Decimal('1250.50'),
      } });
      const payment = await tx.payment.create({ data: { userId: buyer.id, listingId: listing.id, idempotencyKey: marker, amountMinor: 125050n } });
      const expiresAt = new Date(Date.now() + 3_600_000);
      const session = await tx.session.create({ data: { userId: buyer.id, tokenHash: marker.replaceAll('-', '').repeat(2), expiresAt } });
      const verification = await tx.verification.create({ data: { userId: owner.id, type: 'IDENTITY', expiresAt } });
      const media = await tx.media.create({ data: {
        uploadedById: owner.id, verificationId: verification.id, objectKey: `test/${marker}`,
        type: 'DOCUMENT', mimeType: 'application/pdf', sizeBytes: 1024n,
      } });
      await tx.referral.create({ data: { referrerId: owner.id, referredUserId: buyer.id } });
      await tx.notification.create({ data: { userId: buyer.id, titleEn: 'Test', bodyEn: 'Test notification', titleAm: 'ሙከራ' } });
      const related = await tx.listing.findUniqueOrThrow({ where: { id: listing.id }, include: { provider: { include: { user: true } }, location: true, payments: true } });
      assert.ok(related.location && related.price);
      assert.equal(related.provider.user.id, owner.id);
      assert.equal(related.location.cityAm, 'አዲስ አበባ');
      assert.equal(related.titleEn, 'Test home');
      assert.equal(related.titleAm, 'ቤት');
      assert.equal(related.price.toFixed(2), '1250.50');
      assert.equal(related.payments[0]?.amountMinor, 125050n);
      assert.equal(media.visibility, 'PRIVATE');

      await tx.$executeRaw`UPDATE "akgebeya"."locations" SET coordinates = public.ST_SetSRID(public.ST_MakePoint(${38.7578}, ${8.9806}), 4326)::public.geography WHERE id = ${location.id}::uuid`;
      const spatial = await tx.$queryRaw<{ longitude: number; latitude: number; nearby: boolean }[]>`
        SELECT public.ST_X(coordinates::public.geometry) AS longitude, public.ST_Y(coordinates::public.geometry) AS latitude,
          public.ST_DWithin(coordinates, public.ST_SetSRID(public.ST_MakePoint(${38.7578}, ${8.9806}), 4326)::public.geography, 1) AS nearby
        FROM "akgebeya"."locations" WHERE id = ${location.id}::uuid
      `;
      assert.deepEqual(spatial, [{ longitude: 38.7578, latitude: 8.9806, nearby: true }]);

      async function rejects(sql: Prisma.Sql, codes: readonly string[], constraint?: string) {
        await tx.$executeRawUnsafe('SAVEPOINT invalid_write');
        try {
          await assert.rejects(() => tx.$executeRaw(sql), (error: unknown) => {
            assert.ok(error instanceof Prisma.PrismaClientKnownRequestError);
            assert.ok(codes.includes(String(error.meta?.code)), `Unexpected SQLSTATE ${String(error.meta?.code)}`);
            if (constraint) assert.ok(String(error.meta?.message).includes(constraint));
            return true;
          });
        } finally {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_write');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_write');
        }
      }
      await rejects(Prisma.sql`UPDATE "akgebeya"."users" SET email = NULL WHERE id = ${buyer.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."users" SET email = 'UPPER@example.com' WHERE id = ${buyer.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."users" SET email = ${owner.email} WHERE id = ${buyer.id}::uuid`, ['23505']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."users" SET phone = 'invalid' WHERE id = ${buyer.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."listings" SET price = -1 WHERE id = ${listing.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."listings" SET bedrooms = -1 WHERE id = ${listing.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."listings" SET status = 'PUBLISHED' WHERE id = ${listing.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."listings" SET "providerId" = ${randomUUID()}::uuid WHERE id = ${listing.id}::uuid`, ['23503']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."payments" SET "refundedAmountMinor" = "amountMinor" + 1 WHERE id = ${payment.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`INSERT INTO "akgebeya"."payments" ("userId", "idempotencyKey", "amountMinor") VALUES (${buyer.id}::uuid, ${marker}, 100)`, ['23505']);
      await rejects(Prisma.sql`DELETE FROM "akgebeya"."listings" WHERE id = ${listing.id}::uuid`, ['23001', '23503'], 'payments_listingId_fkey');
      await rejects(Prisma.sql`UPDATE "akgebeya"."sessions" SET "tokenHash" = 'plaintext' WHERE id = ${session.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."sessions" SET "expiresAt" = "createdAt" WHERE id = ${session.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."media" SET visibility = 'PUBLIC' WHERE id = ${media.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."media" SET "listingId" = ${listing.id}::uuid WHERE id = ${media.id}::uuid`, ['23514']);
      await rejects(Prisma.sql`UPDATE "akgebeya"."referrals" SET "referrerId" = "referredUserId" WHERE "referredUserId" = ${buyer.id}::uuid`, ['23514']);
      throw rollback;
    }, { timeout: 60_000, maxWait: 10_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await database.user.count({ where: { email: `${marker}@example.com` } }), 0);
  assert.equal(await database.payment.count({ where: { idempotencyKey: marker } }), 0);
});
