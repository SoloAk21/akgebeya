import { prisma } from "../lib/prisma";
import { Session } from "@prisma/client";

export class SessionRepository {
  async createSession(
    userId: string,
    token: string,
    expiresAt: Date,
  ): Promise<Session> {
    return prisma.session.create({
      data: {
        userId,
        token,
        expiresAt,
      },
    });
  }

  async findActiveSession(token: string): Promise<Session | null> {
    const session = await prisma.session.findUnique({
      where: { token },
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      return null;
    }

    return session;
  }

  async revokeSession(token: string): Promise<Session | null> {
    const session = await prisma.session.findUnique({ where: { token } });
    if (!session) return null;

    return prisma.session.update({
      where: { token },
      data: { isRevoked: true },
    });
  }
}

export const sessionRepository = new SessionRepository();
