import { AuthError } from './auth-security.js';
import type { PrismaClient } from './generated/prisma/client.js';

// Approved flat fee for either rental or sale listings. Change the revision
// whenever the business rule changes; future payment creation must recalculate.
const AMOUNT_MINOR_UNITS = 100000;
const POLICY_REVISION = 'flat-etb-1000-v1';

export function calculateListingFee() {
  return {
    currency: 'ETB' as const,
    amount: `${Math.floor(AMOUNT_MINOR_UNITS / 100)}.${String(AMOUNT_MINOR_UNITS % 100).padStart(2, '0')}`,
    amountMinorUnits: AMOUNT_MINOR_UNITS,
    policyRevision: POLICY_REVISION,
  };
}

export async function readListingFee(database: Pick<PrismaClient, '$queryRaw'>, accountId: string, id: string) {
  // One statement gives a consistent snapshot of ownership, version and eligibility.
  const [listing] = await database.$queryRaw<Array<{
    id: string; version: number; status: string; providerStatus: string | null;
  }>>`
    SELECT l.id, l.version, l.status, p.status AS "providerStatus"
    FROM akgebeya_foundation.listing_draft l
    LEFT JOIN akgebeya_foundation.provider_application p ON p."accountId" = l."accountId"
    WHERE l.id = ${id}::uuid AND l."accountId" = ${accountId}::uuid`;
  if (!listing) throw new AuthError(404, 'LISTING_NOT_FOUND', 'Property not found.');
  if (listing.providerStatus !== 'APPROVED') throw new AuthError(403, 'APPROVED_PROVIDER_REQUIRED', 'An approved provider account is required to view the listing fee.');
  if (listing.status !== 'COMPLETE') throw new AuthError(409, 'COMPLETE_LISTING_REQUIRED', 'Complete and save your property before viewing its listing fee.');
  const fee = calculateListingFee();
  return { listingId: listing.id, sourceVersion: listing.version, currency: fee.currency,
    amount: fee.amount, policyRevision: fee.policyRevision, calculatedAt: new Date().toISOString() };
}
