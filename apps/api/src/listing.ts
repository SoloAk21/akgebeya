import { randomUUID } from 'node:crypto';
import { AuthError } from './auth-security.js';
import { UUID } from './admin.js';
import type { PrismaClient } from './generated/prisma/client.js';
import type { Address } from './geocoding.js';
import { missingListingFields, type ListingEditInput } from './listing-validation.js';

export interface ListingInput {
  requestId: string;
  title: string;
  transactionType: 'RENT' | 'SALE';
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL';
}

export function listingInput(value: unknown): ListingInput {
  const invalid = () => new AuthError(400, 'INVALID_LISTING', 'Enter a title of 1–120 characters and choose a transaction and property type.');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  const keys = ['requestId', 'title', 'transactionType', 'propertyType'];
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))
    || typeof input['requestId'] !== 'string' || !UUID.test(input['requestId'])
    || typeof input['title'] !== 'string' || /\p{Cc}|\p{Cf}/u.test(input['title'])
    || typeof input['transactionType'] !== 'string' || !['RENT', 'SALE'].includes(input['transactionType'])
    || typeof input['propertyType'] !== 'string' || !['APARTMENT', 'HOUSE', 'LAND', 'COMMERCIAL'].includes(input['propertyType'])) throw invalid();
  const title = input['title'].trim().normalize('NFC');
  if ([...title].length < 1 || [...title].length > 120) throw invalid();
  return { requestId: input['requestId'].toLowerCase(), title,
    transactionType: input['transactionType'] as ListingInput['transactionType'],
    propertyType: input['propertyType'] as ListingInput['propertyType'] };
}

interface ListingRow extends ListingInput {
  id: string;
  status: 'DRAFT' | 'COMPLETE';
  creationPayload: Pick<ListingInput, 'title' | 'transactionType' | 'propertyType'>;
  description: string;
  priceEtb: { toString(): string } | null;
  areaSqm: { toString(): string } | null;
  bedrooms: number | null;
  bathrooms: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  countryId: string;
  regionId: string;
  cityId: string;
  subcityId: string;
  latitude: number;
  longitude: number;
  address: Address | null;
}

function publicListing(row: ListingRow) {
  const decimal = (value: { toString(): string } | null) => {
    if (value === null) return null;
    const [whole, fraction = ''] = value.toString().split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  };
  const details = { description: row.description, priceEtb: decimal(row.priceEtb), areaSqm: decimal(row.areaSqm),
    bedrooms: row.bedrooms, bathrooms: row.bathrooms, propertyType: row.propertyType };
  return { id: row.id, title: row.title, transactionType: row.transactionType,
    propertyType: row.propertyType, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
    description: details.description, priceEtb: details.priceEtb, areaSqm: details.areaSqm,
    bedrooms: row.bedrooms, bathrooms: row.bathrooms, version: row.version, missingFields: missingListingFields(details),
    location: { countryId: row.countryId, regionId: row.regionId, cityId: row.cityId,
      subcityId: row.subcityId, latitude: row.latitude, longitude: row.longitude, address: row.address } };
}

export async function listListings(database: PrismaClient, accountId: string) {
  const rows = await database.$queryRaw<ListingRow[]>`
    SELECT * FROM akgebeya_foundation.listing_draft WHERE "accountId" = ${accountId}::uuid
    ORDER BY "createdAt" DESC, id DESC LIMIT 50`;
  return rows.map(publicListing);
}

export async function readListing(database: Pick<PrismaClient, '$queryRaw'>, accountId: string, id: string) {
  const [row] = await database.$queryRaw<ListingRow[]>`
    SELECT * FROM akgebeya_foundation.listing_draft WHERE id = ${id}::uuid AND "accountId" = ${accountId}::uuid`;
  if (!row) throw new AuthError(404, 'LISTING_NOT_FOUND', 'Draft not found.');
  return publicListing(row);
}

export async function createListing(database: PrismaClient, accountId: string, input: ListingInput) {
  return database.$transaction(async tx => {
    // Serialize requests for this owner before looking up the idempotency key.
    await tx.$queryRaw`SELECT id FROM akgebeya_foundation.account WHERE id = ${accountId}::uuid FOR UPDATE`;
    const [existing] = await tx.$queryRaw<ListingRow[]>`
      SELECT * FROM akgebeya_foundation.listing_draft
      WHERE "accountId" = ${accountId}::uuid AND "requestId" = ${input.requestId}::uuid`;
    if (existing) {
      if (existing.creationPayload.title !== input.title || existing.creationPayload.transactionType !== input.transactionType || existing.creationPayload.propertyType !== input.propertyType) {
        throw new AuthError(409, 'REQUEST_CONFLICT', 'This request was already used for a different draft.');
      }
      return { created: false, listing: publicListing(existing) };
    }
    const [count] = await tx.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*) AS total FROM akgebeya_foundation.listing_draft WHERE "accountId" = ${accountId}::uuid`;
    if (Number(count?.total ?? 0) >= 50) throw new AuthError(409, 'DRAFT_LIMIT_REACHED', 'You have reached the limit of 50 drafts.');
    // These locks keep eligibility and the location snapshot stable through insertion.
    const [provider] = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM akgebeya_foundation.provider_application WHERE "accountId" = ${accountId}::uuid FOR SHARE`;
    if (provider?.status !== 'APPROVED') throw new AuthError(403, 'APPROVED_PROVIDER_REQUIRED', 'An approved provider account is required to create a draft.');
    const [location] = await tx.$queryRaw<Array<{ confirmed: boolean }>>`
      SELECT confirmed FROM akgebeya_foundation.account_location WHERE "accountId" = ${accountId}::uuid FOR SHARE`;
    if (!location?.confirmed) throw new AuthError(409, 'CONFIRMED_LOCATION_REQUIRED', 'Save and confirm your property location before creating a draft.');
    const [row] = await tx.$queryRaw<ListingRow[]>`
      INSERT INTO akgebeya_foundation.listing_draft
        (id, "accountId", "requestId", title, "transactionType", "propertyType", "creationPayload",
         "countryId", "regionId", "cityId", "subcityId", latitude, longitude, address)
      SELECT ${randomUUID()}::uuid, ${accountId}::uuid, ${input.requestId}::uuid, ${input.title},
        ${input.transactionType}, ${input.propertyType}, ${JSON.stringify({ title: input.title, transactionType: input.transactionType, propertyType: input.propertyType })}::jsonb,
        "countryId", "regionId", "cityId", "subcityId", latitude, longitude, address
      FROM akgebeya_foundation.account_location WHERE "accountId" = ${accountId}::uuid
      RETURNING *`;
    if (!row) throw new Error('Draft creation returned no record');
    return { created: true, listing: publicListing(row) };
  });
}

export async function editListing(database: PrismaClient, accountId: string, id: string, input: ListingEditInput) {
  return database.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM akgebeya_foundation.account WHERE id = ${accountId}::uuid FOR UPDATE`;
    const [provider] = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM akgebeya_foundation.provider_application WHERE "accountId" = ${accountId}::uuid FOR SHARE`;
    const [row] = await tx.$queryRaw<ListingRow[]>`
      SELECT * FROM akgebeya_foundation.listing_draft WHERE id = ${id}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`;
    if (!row) throw new AuthError(404, 'LISTING_NOT_FOUND', 'Listing not found.');
    if (provider?.status !== 'APPROVED') throw new AuthError(403, 'APPROVED_PROVIDER_REQUIRED', 'An approved provider account is required to edit a listing.');
    if (row.version !== input.version) throw new AuthError(409, 'VERSION_CONFLICT', 'This listing changed. Reload its latest details before saving again.');
    const previous = publicListing(row);
    const status = input.complete ? 'COMPLETE' : 'DRAFT';
    const fields = ['title', 'transactionType', 'propertyType', 'description', 'priceEtb', 'areaSqm', 'bedrooms', 'bathrooms'] as const;
    if (row.status === status && fields.every(key => previous[key] === input[key])) return previous;
    const [updated] = await tx.$queryRaw<ListingRow[]>`
      UPDATE akgebeya_foundation.listing_draft SET title = ${input.title}, "transactionType" = ${input.transactionType},
        "propertyType" = ${input.propertyType}, description = ${input.description}, "priceEtb" = ${input.priceEtb}::numeric,
        "areaSqm" = ${input.areaSqm}::numeric, bedrooms = ${input.bedrooms}::integer, bathrooms = ${input.bathrooms}::integer,
        status = ${status}, version = version + 1, "updatedAt" = clock_timestamp()
      WHERE id = ${id}::uuid AND "accountId" = ${accountId}::uuid RETURNING *`;
    if (!updated) throw new Error('Listing update returned no record');
    return publicListing(updated);
  });
}
