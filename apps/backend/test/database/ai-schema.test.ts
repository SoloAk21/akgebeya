import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../../src/database.js';
import { Prisma } from '../../src/generated/prisma/client.js';

const db = createDatabaseClient();
after(() => db.$disconnect());

test('Neon AI_ASSIST requires bilingual content and preserves publication protections', async () => {
  const rollback = new Error('ROLLBACK_AI_SCHEMA');
  try {
    await db.$transaction(async tx => {
      const user = await tx.user.create({ data: { email: randomUUID() + '@example.com', displayName: 'AI schema fixture' } });
      const provider = await tx.provider.create({ data: { userId: user.id, role: 'OWNER', nameEn: 'AI schema fixture' } });
      const location = await tx.location.create({ data: { regionEn: 'Test region', cityEn: 'Test city' } });
      const row = await tx.listing.create({ data: {
        providerId: provider.id, locationId: location.id, category: 'LAND', type: 'SALE',
        propertyType: 'RESIDENTIAL_LAND', titleEn: 'Test land', descriptionEn: 'Schema fixture', price: '100',
      } });
      async function reject(data: Prisma.ListingUpdateInput) {
        await tx.$executeRawUnsafe('SAVEPOINT invalid_ai_listing');
        let denied = false;
        try { await tx.listing.update({ where: { id: row.id }, data }); }
        catch (error) {
          // Prisma 6 reports PostgreSQL CHECK failures as unknown request errors.
          denied = (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2004')
            || (error instanceof Prisma.PrismaClientUnknownRequestError && /23514/.test(error.message));
        } finally {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_ai_listing');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_ai_listing');
        }
        assert.ok(denied, 'Expected CHECK constraint rejection');
      }
      await reject({ status: 'AI_ASSIST' });
      await reject({ status: 'AI_ASSIST', titleAm: '\u1218\u122c\u1275' });
      await reject({ status: 'AI_ASSIST', descriptionAm: '\u12e8\u1219\u12a8\u122b \u1218\u122c\u1275' });
      await tx.listing.update({ where: { id: row.id }, data: {
        status: 'AI_ASSIST', titleAm: '\u1218\u122c\u1275', descriptionAm: '\u12e8\u1219\u12a8\u122b \u1218\u122c\u1275',
      } });
      for (const field of ['titleEn', 'titleAm', 'descriptionEn', 'descriptionAm'] as const) {
        await reject({ [field]: null });
        await reject({ [field]: ' \t\n' });
      }
      await reject({ price: '0' });
      await reject({ bedrooms: -1 });
      await reject({ category: 'RESIDENTIAL' });
      for (const status of ['DRAFT', 'COMPLETE', 'VALIDATE', 'AI_ASSIST'] as const) {
        await tx.listing.update({ where: { id: row.id }, data: { status } });
        await reject({ publishedAt: new Date() });
      }
      await reject({ status: 'PUBLISHED', publishedAt: null });
      await tx.listing.update({ where: { id: row.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
      await reject({ deletedAt: new Date() });
      throw rollback;
    }, { timeout: 120_000, maxWait: 10_000 });
  } catch (error) { if (error !== rollback) throw error; }
});
