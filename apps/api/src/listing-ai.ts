import { AuthError, digest } from './auth-security.js';
import { UUID } from './admin.js';
import { listingEditInput } from './listing-validation.js';
import { AiError, validateListingCopy, type CopyFacts, type ListingCopy, type ListingGenerator } from './gemini.js';
import type { PrismaClient } from './generated/prisma/client.js';

export function aiContentInput(value: unknown): { version: number; requestId: string; consent: true } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
    || !('version' in value) || !Number.isInteger(value.version) || (value.version as number) < 1 || (value.version as number) > 2147483647
    || !('requestId' in value) || typeof value.requestId !== 'string' || !UUID.test(value.requestId)
    || !('consent' in value) || value.consent !== true) {
    throw new AuthError(400, 'INVALID_AI_REQUEST', 'Reload the property and confirm sharing its saved details to generate listing text.');
  }
  return { version: value.version as number, requestId: value.requestId.toLowerCase(), consent: true };
}
interface AiRow { requestId: string; sourceVersion: number; copy: ListingCopy; model: string; generatedAt: Date }
interface FactsRow extends CopyFacts { version: number; status: string }
type Database = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
function content(row: AiRow | undefined, currentVersion: number) {
  return { content: row ? { en: row.copy.en, am: row.copy.am, sourceVersion: row.sourceVersion, model: row.model, generatedAt: row.generatedAt } : null,
    currentVersion, stale: row ? row.sourceVersion !== currentVersion : false };
}
async function saved(database: Database, listingId: string) {
  const [row] = await database.$queryRaw<AiRow[]>`
    SELECT "requestId", "sourceVersion", copy, model, "generatedAt" FROM akgebeya_foundation.listing_ai_content WHERE "listingId" = ${listingId}::uuid`;
  return row;
}
async function lockedFacts(database: Database, accountId: string, listingId: string) {
  await database.$queryRaw`SELECT id FROM akgebeya_foundation.account WHERE id = ${accountId}::uuid FOR UPDATE`;
  const [provider] = await database.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM akgebeya_foundation.provider_application WHERE "accountId" = ${accountId}::uuid FOR SHARE`;
  const [row] = await database.$queryRaw<FactsRow[]>`
    SELECT title, description, "transactionType", "propertyType", "priceEtb"::text AS "priceEtb", "areaSqm"::text AS "areaSqm",
      bedrooms, bathrooms, "subcityId", version, status
    FROM akgebeya_foundation.listing_draft WHERE id = ${listingId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`;
  if (!row) throw new AuthError(404, 'LISTING_NOT_FOUND', 'Property not found.');
  if (provider?.status !== 'APPROVED') throw new AuthError(403, 'APPROVED_PROVIDER_REQUIRED', 'An approved provider account is required to generate listing text.');
  return row;
}
function checkFacts(row: FactsRow, input: ReturnType<typeof aiContentInput>): CopyFacts {
  if (row.version !== input.version) throw new AuthError(409, 'VERSION_CONFLICT', 'This property changed. Reload its saved details before generating text.');
  if (row.status !== 'COMPLETE') throw new AuthError(409, 'COMPLETE_LISTING_REQUIRED', 'Complete and save your property details before generating listing text.');
  // Reuse factual validation and pass only the explicit provider allowlist.
  const valid = listingEditInput({ version: row.version, title: row.title, description: row.description,
    transactionType: row.transactionType, propertyType: row.propertyType, priceEtb: row.priceEtb, areaSqm: row.areaSqm,
    bedrooms: row.bedrooms, bathrooms: row.bathrooms, complete: true });
  return { title: valid.title, description: valid.description, transactionType: valid.transactionType, propertyType: valid.propertyType,
    priceEtb: valid.priceEtb!, areaSqm: valid.areaSqm!, bedrooms: valid.bedrooms, bathrooms: valid.bathrooms, subcityId: row.subcityId };
}
export async function readAiContent(database: PrismaClient, accountId: string, listingId: string) {
  return database.$transaction(async tx => {
    const [row] = await tx.$queryRaw<Array<{ version: number }>>`
      SELECT version FROM akgebeya_foundation.listing_draft WHERE id = ${listingId}::uuid AND "accountId" = ${accountId}::uuid FOR SHARE`;
    if (!row) throw new AuthError(404, 'LISTING_NOT_FOUND', 'Property not found.');
    return content(await saved(tx, listingId), row.version);
  });
}
const activeListings = new Set<string>();
export async function generateAiContent(database: PrismaClient, accountId: string, listingId: string,
  input: ReturnType<typeof aiContentInput>, generator: ListingGenerator, signal?: AbortSignal) {
  const initial = await database.$transaction(async tx => {
    const row = await lockedFacts(tx, accountId, listingId);
    const facts = checkFacts(row, input), previous = await saved(tx, listingId);
    if (previous?.requestId === input.requestId && previous.sourceVersion !== input.version) throw new AuthError(409, 'AI_REQUEST_CONFLICT', 'Use a new generation request for the updated property.');
    return { facts, cached: previous?.requestId === input.requestId ? content(previous, row.version) : null };
  });
  if (initial.cached) return initial.cached;
  signal?.throwIfAborted();
  const key = listingId.toLowerCase();
  if (activeListings.has(key)) throw new AiError(429, 'AI_GENERATION_BUSY', 'Listing text is already being generated for this property. Reload it shortly.', 5);
  if (activeListings.size >= 2) throw new AiError(429, 'AI_GENERATION_BUSY', 'Listing text generation is busy. Try again shortly.', 5);
  activeListings.add(key);
  try {
    const window = Math.floor(Date.now() / 3600000), expiresAt = new Date((window + 1) * 3600000);
    await database.authAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const quotaKey = digest(`listing-ai:${accountId}:${window}`);
    const attempt = await database.authAttempt.upsert({ where: { key: quotaKey }, create: { key: quotaKey, count: 1, expiresAt }, update: { count: { increment: 1 } } });
    if (attempt.count > 5) throw new AiError(429, 'AI_RATE_LIMITED', 'You can generate listing text up to five times per hour. Try again next hour.', Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000)));
    const copy = validateListingCopy(await generator.generate(initial.facts, signal), initial.facts);
    signal?.throwIfAborted();
    return await database.$transaction(async tx => {
      const row = await lockedFacts(tx, accountId, listingId);
      checkFacts(row, input);
      const previous = await saved(tx, listingId);
      if (previous?.requestId === input.requestId) {
        if (previous.sourceVersion !== input.version) throw new AuthError(409, 'AI_REQUEST_CONFLICT', 'Use a new generation request for the updated property.');
        return content(previous, row.version);
      }
      signal?.throwIfAborted();
      await tx.$executeRaw`INSERT INTO akgebeya_foundation.listing_ai_content ("listingId", "requestId", "sourceVersion", copy, model)
        VALUES (${listingId}::uuid, ${input.requestId}::uuid, ${input.version}, ${JSON.stringify(copy)}::jsonb, ${generator.model})
        ON CONFLICT ("listingId") DO UPDATE SET "requestId" = EXCLUDED."requestId", "sourceVersion" = EXCLUDED."sourceVersion",
          copy = EXCLUDED.copy, model = EXCLUDED.model, "generatedAt" = clock_timestamp()`;
      return content(await saved(tx, listingId), row.version);
    });
  } finally { activeListings.delete(key); }
}
