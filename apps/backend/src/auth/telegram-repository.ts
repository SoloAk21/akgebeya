import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import type { TelegramIdentity } from './telegram-verifier.js';

export interface TelegramRepository {
  resolveUser(identity: TelegramIdentity): Promise<{ id: string }>;
}

export class PrismaTelegramRepository implements TelegramRepository {
  constructor(private readonly database: Pick<PrismaClient, 'user'>) {}

  async resolveUser(identity: TelegramIdentity) {
    const where = { telegramId: identity.telegramId };
    const existing = await this.database.user.findUnique({ where, select: { id: true } });
    if (existing) return existing;
    try {
      // Database defaults determine role/status. Never link by name, username or contact.
      return await this.database.user.create({ data: identity, select: { id: true } });
    } catch (error) {
      // Concurrent first logins converge on the unique verified Telegram identity.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const concurrent = await this.database.user.findUnique({ where, select: { id: true } });
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }
}
