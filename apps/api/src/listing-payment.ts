import { randomUUID } from 'node:crypto';
import { AuthError } from './auth-security.js';
import { UUID } from './admin.js';
import { calculateListingFee } from './listing-fee.js';
import { ChapaError, validChapaCheckout, type ChapaGateway } from './chapa.js';
import type { PrismaClient } from './generated/prisma/client.js';

export function paymentInput(value: unknown): { version: number; requestId: string; consent: true } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3
    || !('version' in value) || !Number.isInteger(value.version) || (value.version as number) < 1 || (value.version as number) > 2147483647
    || !('requestId' in value) || typeof value.requestId !== 'string' || !UUID.test(value.requestId)
    || !('consent' in value) || value.consent !== true) throw new AuthError(400, 'INVALID_PAYMENT_REQUEST', 'Reload the property and confirm opening a sandbox checkout.');
  return { version: value.version as number, requestId: value.requestId.toLowerCase(), consent: true };
}
interface Source { version: number; mediaVersion: number; status: string; providerStatus: string | null }
interface Payment {
  id: string; listingId: string; requestId: string; reference: string; sourceVersion: number; mediaVersion: number;
  amount: string; currency: 'ETB'; policyRevision: string;
  status: 'INITIALIZING' | 'READY' | 'UNKNOWN' | 'FAILED'; checkoutUrl: string | null; createdAt: Date;
}
type Database = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;
async function source(database: Database, accountId: string, listingId: string, lock = false) {
  if (lock) {
    await database.$queryRaw`SELECT id FROM akgebeya_foundation.account WHERE id = ${accountId}::uuid FOR UPDATE`;
    await database.$queryRaw`SELECT "accountId" FROM akgebeya_foundation.provider_application WHERE "accountId" = ${accountId}::uuid FOR SHARE`;
    await database.$queryRaw`SELECT id FROM akgebeya_foundation.listing_draft WHERE id = ${listingId}::uuid AND "accountId" = ${accountId}::uuid FOR UPDATE`;
  }
  const [row] = await database.$queryRaw<Source[]>`
    SELECT l.version, l."mediaVersion", l.status, p.status AS "providerStatus"
    FROM akgebeya_foundation.listing_draft l LEFT JOIN akgebeya_foundation.provider_application p ON p."accountId" = l."accountId"
    WHERE l.id = ${listingId}::uuid AND l."accountId" = ${accountId}::uuid`;
  if (!row) throw new AuthError(404, 'LISTING_NOT_FOUND', 'Property not found.');
  return row;
}
async function saved(database: Database, listingId: string) {
  const [payment] = await database.$queryRaw<Payment[]>`
    SELECT id, "listingId", "requestId", reference, "sourceVersion", "mediaVersion", amount::text AS amount,
      currency, "policyRevision", status, "checkoutUrl", "createdAt"
    FROM akgebeya_foundation.listing_payment WHERE "listingId" = ${listingId}::uuid`;
  return payment;
}
function snapshotChanged(payment: Payment, current: Source) {
  const fee = calculateListingFee();
  return payment.sourceVersion !== current.version || payment.mediaVersion !== current.mediaVersion
    || payment.policyRevision !== fee.policyRevision || payment.amount !== fee.amount || payment.currency !== fee.currency;
}
function result(payment: Payment | undefined, current: Source) {
  const stale = Boolean(payment && (snapshotChanged(payment, current) || current.status !== 'COMPLETE' || current.providerStatus !== 'APPROVED'));
  return { payment: payment ? { id: payment.id, listingId: payment.listingId, sourceVersion: payment.sourceVersion,
    amount: payment.amount, currency: payment.currency, policyRevision: payment.policyRevision, status: payment.status,
    checkoutUrl: stale ? null : payment.checkoutUrl, createdAt: payment.createdAt } : null,
  currentVersion: current.version, stale };
}
export async function readListingPayment(database: PrismaClient, accountId: string, listingId: string) {
  return database.$transaction(async tx => {
    const current = await source(tx, accountId, listingId);
    return result(await saved(tx, listingId), current);
  }, { isolationLevel: 'RepeatableRead' });
}
export async function initializeListingPayment(database: PrismaClient, accountId: string, listingId: string,
  input: ReturnType<typeof paymentInput>, gateway: ChapaGateway, returnUrl: string) {
  const reservation = await database.$transaction(async tx => {
    const current = await source(tx, accountId, listingId, true);
    if (current.providerStatus !== 'APPROVED') throw new AuthError(403, 'APPROVED_PROVIDER_REQUIRED', 'An approved provider account is required to open checkout.');
    if (current.status !== 'COMPLETE') throw new AuthError(409, 'COMPLETE_LISTING_REQUIRED', 'Complete and save the property before opening checkout.');
    if (current.version !== input.version) throw new AuthError(409, 'VERSION_CONFLICT', 'The property changed. Reload its saved details before opening checkout.');
    const existing = await saved(tx, listingId);
    if (existing) {
      if (snapshotChanged(existing, current)) throw new AuthError(409, 'PAYMENT_SOURCE_CHANGED', 'This property changed after checkout was started. The existing attempt needs manual resolution; another checkout will not be created.');
      return { created: false as const, payment: existing, current };
    }
    // Configuration validation is local. The outbound request happens only after this reservation commits.
    gateway.assertConfigured();
    const [recent] = await tx.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*) AS total FROM akgebeya_foundation.listing_payment payment
      JOIN akgebeya_foundation.listing_draft listing ON listing.id = payment."listingId"
      WHERE listing."accountId" = ${accountId}::uuid AND payment."createdAt" > clock_timestamp() - interval '1 hour'`;
    if (Number(recent?.total ?? 0) >= 5) throw new AuthError(429, 'PAYMENT_RATE_LIMITED', 'Too many new checkout attempts. Try again later.');
    const fee = calculateListingFee(), id = randomUUID(), reference = `akg-${id}`;
    await tx.$executeRaw`INSERT INTO akgebeya_foundation.listing_payment
      (id, "listingId", "requestId", reference, "sourceVersion", "mediaVersion", amount, currency, "policyRevision")
      VALUES (${id}::uuid, ${listingId}::uuid, ${input.requestId}::uuid, ${reference}, ${current.version}, ${current.mediaVersion},
        ${fee.amount}::numeric, ${fee.currency}, ${fee.policyRevision})`;
    const payment = await saved(tx, listingId);
    if (!payment) throw new Error('Payment reservation returned no record');
    return { created: true as const, payment, current };
  });
  if (!reservation.created) return result(reservation.payment, reservation.current);
  let status: Payment['status'], checkoutUrl: string | null = null;
  try {
    const initialized = await gateway.initialize({ amount: reservation.payment.amount, currency: reservation.payment.currency,
      reference: reservation.payment.reference, returnUrl });
    if (!validChapaCheckout(initialized.checkoutUrl)) throw new ChapaError(502, 'CHAPA_RESULT_UNKNOWN', 'The checkout address could not be confirmed.');
    checkoutUrl = initialized.checkoutUrl; status = 'READY';
  } catch (error) {
    status = error instanceof ChapaError && error.outcome === 'FAILED' ? 'FAILED' : 'UNKNOWN';
  }
  // Client disconnection never cancels persistence. A crash or database failure
  // leaves INITIALIZING, which blocks duplicate initialization after restart.
  await database.$executeRaw`UPDATE akgebeya_foundation.listing_payment SET status = ${status}, "checkoutUrl" = ${checkoutUrl}
    WHERE id = ${reservation.payment.id}::uuid AND status = 'INITIALIZING'`;
  return readListingPayment(database, accountId, listingId);
}
