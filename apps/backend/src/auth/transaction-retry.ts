import { Prisma } from '../generated/prisma/client.js';

export function isLockFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2010'
    && ['55P03', '40P01'].includes(String(error.meta?.code));
}
export async function retryTransaction<T>(run: () => Promise<T>, canRetry: (error: unknown) => boolean): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run(); }
    catch (error) {
      if (attempt >= 3 || !canRetry(error)) throw error;
    }
  }
}
