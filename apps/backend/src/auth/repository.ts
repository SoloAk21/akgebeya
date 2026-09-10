import type { PrismaClient } from '../generated/prisma/client.js';
import type { AuthRepository } from './types.js';

const userSelect = {
  id: true, email: true, phone: true, displayName: true, role: true,
  preferredLocale: true, status: true, deletedAt: true,
} as const;

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly database: Pick<PrismaClient, 'user' | 'session'>) {}

  findUser(id: string) {
    return this.database.user.findUnique({ where: { id }, select: userSelect });
  }

  createSession(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.database.session.create({ data: input, select: { id: true } });
  }

  findSession(tokenHash: string) {
    return this.database.session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, tokenHash: true, expiresAt: true, revokedAt: true, user: { select: userSelect } },
    });
  }

  async revokeSession(id: string, userId: string, at: Date) {
    await this.database.session.updateMany({
      where: { id, userId, revokedAt: null }, data: { revokedAt: at },
    });
  }
}
