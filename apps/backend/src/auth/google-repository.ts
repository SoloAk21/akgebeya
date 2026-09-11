import { retryTransaction, isLockFailure } from './transaction-retry.js';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { PrismaAuthRepository } from './repository.js';
import type { AuthRepository } from './types.js';
import type { GoogleIdentity } from './google-verifier.js';

export interface GoogleRepository {
  withIdentity<T>(identity: GoogleIdentity, issue: (userId: string, auth: AuthRepository) => Promise<T>): Promise<T>;
}
export class PrismaGoogleRepository implements GoogleRepository {
  constructor(private readonly db: PrismaClient) {}
  async withIdentity<T>(identity: GoogleIdentity, issue: (id: string, auth: AuthRepository) => Promise<T>): Promise<T> {
    // Unique-index races and transient lock/deadlock failures retry the entire transaction.
    return retryTransaction(() => this.db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      for (const key of ['google:' + identity.googleSub, 'email:' + identity.email].sort()) {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 4400))::text`;
      }
      const subject = await tx.user.findUnique({ where: { googleSub: identity.googleSub } });
      const email = await tx.user.findUnique({ where: { email: identity.email } });
      if (email && email.id !== subject?.id) throw new HttpError('ACCOUNT_LINKING_CONFLICT');
      const user = subject ?? await tx.user.create({
        data: { googleSub: identity.googleSub, email: identity.email, displayName: 'AkGebeya user' },
      });
      // Preserve existing profile, contact identities and permissions on repeat login.
      return issue(user.id, new PrismaAuthRepository(tx));
    }, { timeout: 15_000, maxWait: 10_000 }), error => isLockFailure(error)
      || (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)));
  }
}
