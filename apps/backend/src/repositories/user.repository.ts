import { prisma } from "../lib/prisma";
import { User, Language } from "@prisma/client";

export class UserRepository {
  async findByTelegramId(telegramId: bigint): Promise<User | null> {
    return prisma.user.findUnique({
      where: { telegramId },
    });
  }

  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id },
    });
  }

  async createTelegramUser(data: {
    telegramId: bigint;
    fullName?: string;
    avatarUrl?: string;
    language?: Language;
  }): Promise<User> {
    return prisma.user.create({
      data: {
        telegramId: data.telegramId,
        fullName: data.fullName,
        avatarUrl: data.avatarUrl,
        language: data.language || Language.EN,
      },
    });
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    return prisma.user.update({
      where: { id },
      data,
    });
  }
}

export const userRepository = new UserRepository();
