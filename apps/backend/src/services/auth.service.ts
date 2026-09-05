import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.config";
import {
  userRepository,
  UserRepository,
} from "../repositories/user.repository";
import {
  sessionRepository,
  SessionRepository,
} from "../repositories/session.repository";
import { User, Language } from "@prisma/client";

export interface TelegramUserData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

export class AuthService {
  constructor(
    private userRepo: UserRepository = userRepository,
    private sessionRepo: SessionRepository = sessionRepository,
  ) {}

  verifyTelegramInitData(
    initData: string,
    botToken: string,
  ): TelegramUserData | null {
    try {
      const params = new URLSearchParams(initData);
      const hash = params.get("hash");
      if (!hash) return null;

      params.delete("hash");

      const dataCheckString = Array.from(params.entries())
        .map(([key, value]) => `${key}=${value}`)
        .sort()
        .join("\n");

      const secretKey = crypto
        .createHmac("sha256", "WebAppData")
        .update(botToken)
        .digest();

      const calculatedHash = crypto
        .createHmac("sha256", secretKey)
        .update(dataCheckString)
        .digest("hex");

      if (calculatedHash !== hash) {
        return null;
      }

      const userParam = params.get("user");
      if (!userParam) return null;

      return JSON.parse(userParam) as TelegramUserData;
    } catch {
      return null;
    }
  }

  async authenticateTelegram(
    initData: string,
  ): Promise<{ user: User; token: string }> {
    const telegramUser = this.verifyTelegramInitData(
      initData,
      env.TELEGRAM_BOT_TOKEN,
    );

    if (!telegramUser) {
      throw new Error("Invalid Telegram authentication signature");
    }

    const telegramId = BigInt(telegramUser.id);
    let user = await this.userRepo.findByTelegramId(telegramId);

    const fullName = [telegramUser.first_name, telegramUser.last_name]
      .filter(Boolean)
      .join(" ");
    const language = telegramUser.language_code?.toLowerCase().startsWith("am")
      ? Language.AM
      : Language.EN;

    if (!user) {
      user = await this.userRepo.createTelegramUser({
        telegramId,
        fullName,
        avatarUrl: telegramUser.photo_url,
        language,
      });
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    await this.sessionRepo.createSession(user.id, token, expiresAt);

    return { user, token };
  }

  async getProfile(userId: string): Promise<User | null> {
    return this.userRepo.findById(userId);
  }

  async logout(token: string): Promise<void> {
    await this.sessionRepo.revokeSession(token);
  }
}

export const authService = new AuthService();
