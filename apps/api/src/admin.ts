import { AuthError } from './auth-security.js';
import type { PrismaClient } from './generated/prisma/client.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function reviewInput(value: unknown): { decision: 'APPROVED' | 'REJECTED'; reason: string | null } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).some(key => !['decision', 'reason'].includes(key)) || !('decision' in value)
    || typeof value.decision !== 'string' || !['APPROVED', 'REJECTED'].includes(value.decision)
    || ('reason' in value && typeof value.reason !== 'string')) {
    throw new AuthError(400, 'INVALID_REVIEW', 'Choose Approve or Reject and provide a valid reason.');
  }
  const reason = 'reason' in value ? (value.reason as string).trim() : '';
  if (reason.length > 500 || /\p{Cc}|\p{Cf}/u.test(reason) || (value.decision === 'REJECTED' && !reason)) {
    throw new AuthError(400, 'INVALID_REVIEW', 'A rejection needs a reason. Use up to 500 characters without control characters.');
  }
  return { decision: value.decision as 'APPROVED' | 'REJECTED', reason: reason || null };
}

const adminFields = { accountId: true, providerType: true, status: true, submittedAt: true,
  account: { select: { email: true, displayName: true } },
  review: { select: { decision: true, reason: true, reviewedAt: true, reviewerId: true } } } as const;

export async function reviewQueue(database: PrismaClient, reviewerId: string, url: string) {
  const params = new URL(url, 'http://localhost').searchParams;
  const cursor = params.get('cursor');
  if ([...params.keys()].some(key => key !== 'cursor') || params.getAll('cursor').length > 1 || (cursor !== null && !UUID.test(cursor))) {
    throw new AuthError(400, 'INVALID_CURSOR', 'Use a valid review queue cursor.');
  }
  const rows = await database.providerApplication.findMany({
    where: { status: 'PENDING', accountId: { not: reviewerId, ...(cursor ? { gt: cursor } : {}) } },
    orderBy: { accountId: 'asc' }, take: 51, select: adminFields,
  });
  return { applications: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.accountId : null };
}

export async function readApplication(database: PrismaClient, accountId: string) {
  const application = await database.providerApplication.findUnique({ where: { accountId }, select: adminFields });
  if (!application) throw new AuthError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
  return application;
}

export async function decideApplication(database: PrismaClient, reviewerId: string, accountId: string, input: ReturnType<typeof reviewInput>) {
  if (reviewerId.toLowerCase() === accountId.toLowerCase()) throw new AuthError(403, 'SELF_REVIEW_FORBIDDEN', 'Another administrator must review your application.');
  return database.$transaction(async tx => {
    // Serialize role revocation against decisions and competing decisions against each other.
    const [admin] = await tx.$queryRaw<Array<{ isAdmin: boolean }>>`
      SELECT "isAdmin" FROM akgebeya_foundation.account WHERE id = ${reviewerId}::uuid FOR SHARE`;
    if (!admin?.isAdmin) throw new AuthError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
    await tx.$queryRaw`SELECT "accountId" FROM akgebeya_foundation.provider_application WHERE "accountId" = ${accountId}::uuid FOR UPDATE`;
    const current = await tx.providerApplication.findUnique({ where: { accountId }, select: adminFields });
    if (!current) throw new AuthError(404, 'APPLICATION_NOT_FOUND', 'Application not found.');
    if (current.status !== 'PENDING') {
      if (current.review?.decision === input.decision && current.review.reason === input.reason) return current;
      throw new AuthError(409, 'ALREADY_REVIEWED', 'This application already has a decision. Reload to see it.');
    }
    return tx.providerApplication.update({ where: { accountId }, data: {
      status: input.decision, review: { create: { reviewerId, ...input } },
    }, select: adminFields });
  });
}
