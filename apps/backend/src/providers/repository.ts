import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from '../errors.js';
import { retryTransaction, isLockFailure } from '../auth/transaction-retry.js';
import type { ProviderInput, ProviderRecord, ProviderRepository, ProviderStore } from './types.js';

async function record(tx: Pick<Prisma.TransactionClient, 'provider' | 'verification'>, selector: { userId: string } | { id: string }): Promise<ProviderRecord | null> {
  const provider = await tx.provider.findUnique({ where: selector });
  if (!provider) return null;
  const review = await tx.verification.findFirst({
    where: { userId: provider.userId, type: 'PROVIDER' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, status: true, expiresAt: true, reviewedAt: true, createdAt: true },
  });
  return { ...provider, review };
}
export class PrismaProviderRepository implements ProviderRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(userId: string, input: ProviderInput) {
    try {
      const provider = await this.db.provider.create({ data: { ...input, userId } });
      return { ...provider, review: null };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError('PROVIDER_CONFLICT');
      throw error;
    }
  }
  findOwned(userId: string) { return record(this.db, { userId }); }
  withProvider<T>(selector: { userId: string } | { id: string }, run: (store: ProviderStore) => Promise<T>): Promise<T> {
    return retryTransaction(() => this.db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
      const where = 'id' in selector ? Prisma.sql`"id" = ${selector.id}::uuid` : Prisma.sql`"userId" = ${selector.userId}::uuid`;
      await tx.$queryRaw`SELECT id FROM "akgebeya"."providers" WHERE ${where} FOR UPDATE`;
      const current = await record(tx, selector);
      if (!current) throw new HttpError('PROVIDER_NOT_FOUND');
      const userId = current.userId;
      return run({
        record: current,
        isActiveAdmin: async id => {
          const user = await tx.user.findUnique({ where: { id }, select: { role: true, status: true, deletedAt: true } });
          return user?.role === 'ADMIN' && user.status === 'ACTIVE' && user.deletedAt === null;
        },
        expirePending: async at => { await tx.verification.updateMany({
          where: { userId, type: 'PROVIDER', status: 'PENDING', expiresAt: { lte: at } }, data: { status: 'EXPIRED' },
        }); },
        submit: async expiresAt => {
          // Transaction start time can precede a review committed while this request
          // waited for the provider lock. Order new history after all prior reviews.
          await tx.$executeRaw`INSERT INTO "akgebeya"."verifications"
            ("userId", "type", "expiresAt", "createdAt", "updatedAt")
            SELECT ${userId}::uuid, 'PROVIDER', ${expiresAt},
              GREATEST(clock_timestamp(), COALESCE(MAX("createdAt") + interval '1 microsecond', clock_timestamp())),
              clock_timestamp()
            FROM "akgebeya"."verifications" WHERE "userId" = ${userId}::uuid AND "type" = 'PROVIDER'`;
        },
        decide: async (id, status, reviewerId, at, expiresAt) => {
          const changed = await tx.verification.updateMany({
            where: { id, userId, type: 'PROVIDER', status: 'PENDING', expiresAt: { gt: at } },
            data: { status, reviewerId, reviewedAt: at, expiresAt },
          });
          if (changed.count !== 1) throw new HttpError('PROVIDER_CONFLICT');
        },
        setStatus: async status => { await tx.provider.update({ where: { id: current.id }, data: { status } }); },
        reload: async () => (await record(tx, selector))!,
      });
    }, { timeout: 15_000, maxWait: 10_000 }), isLockFailure);
  }
}
