import { retryTransaction, isLockFailure } from './transaction-retry.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { PrismaAuthRepository } from './repository.js';
import type { PhoneOtpRepository, PhoneOtpStore } from './phone-types.js';

export class PrismaPhoneOtpRepository implements PhoneOtpRepository {
  constructor(private readonly database: PrismaClient) {}

  withPhone<T>(phone: string, run: (store: PhoneOtpStore) => Promise<T>): Promise<T> {
    let processingStarted = false;
    return retryTransaction(() => {
      processingStarted = false;
      return this.database.$transaction(async tx => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
        // Transaction-scoped lock also covers the case where the row does not yet exist.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${phone}, 4300))::text`;
        processingStarted = true;
        return run({
          authRepository: new PrismaAuthRepository(tx),
          current: () => tx.phoneOtp.findUnique({ where: { phone } }),
          replace: async challenge => {
            await tx.phoneOtp.upsert({ where: { phone }, create: challenge, update: challenge });
          },
          update: async (id, data) => {
            await tx.phoneOtp.update({ where: { id, phone }, data });
          },
          resolveUser: async displayName => {
            // This runs only after successful OTP verification; role/status use DB defaults.
            await tx.$executeRaw`INSERT INTO "akgebeya"."users" ("phone", "displayName")
              VALUES (${phone}, ${displayName}) ON CONFLICT ("phone") DO NOTHING`;
            return tx.user.findUniqueOrThrow({ where: { phone }, select: { id: true } });
          },
        });
      }, { timeout: 15_000, maxWait: 10_000 });
    }, error => !processingStarted && isLockFailure(error));
  }
}
