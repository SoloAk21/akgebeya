import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { Referral, ReferralStatus } from "@prisma/client";

export class ReferralRepository {
  async getOrCreateReferralCode(userId: string): Promise<string> {
    const existingReferral = await prisma.referral.findFirst({
      where: { referrerId: userId },
    });

    if (existingReferral) {
      return existingReferral.code;
    }

    const uniqueCode = `AKG-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    return uniqueCode;
  }

  async applyReferralCode(
    referredUserId: string,
    code: string,
  ): Promise<Referral> {
    const existingReceived = await prisma.referral.findUnique({
      where: { referredId: referredUserId },
    });

    if (existingReceived) {
      throw new Error("User has already claimed a referral code");
    }

    const referrerReferral = await prisma.referral.findFirst({
      where: { code },
    });

    if (!referrerReferral) {
      throw new Error("Invalid referral code");
    }

    if (referrerReferral.referrerId === referredUserId) {
      throw new Error("Self-referrals are not permitted");
    }

    return prisma.referral.create({
      data: {
        referrerId: referrerReferral.referrerId,
        referredId: referredUserId,
        code,
        status: ReferralStatus.PENDING,
        rewardCredits: 0,
      },
    });
  }

  async rewardReferrerOnFirstVerifiedListing(
    referredUserId: string,
  ): Promise<Referral | null> {
    const referral = await prisma.referral.findUnique({
      where: { referredId: referredUserId },
    });

    if (!referral || referral.status === ReferralStatus.REWARDED) {
      return null;
    }

    return prisma.referral.update({
      where: { id: referral.id },
      data: {
        status: ReferralStatus.REWARDED,
        rewardCredits: 1,
      },
    });
  }

  async getReferralStats(userId: string): Promise<{
    referralCode: string;
    totalInvited: number;
    completed: number;
    rewardCredits: number;
  }> {
    const referralCode = await this.getOrCreateReferralCode(userId);

    const [totalInvited, completed, rewards] = await Promise.all([
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.referral.count({
        where: { referrerId: userId, status: ReferralStatus.REWARDED },
      }),
      prisma.referral.aggregate({
        where: { referrerId: userId, status: ReferralStatus.REWARDED },
        _sum: { rewardCredits: true },
      }),
    ]);

    return {
      referralCode,
      totalInvited,
      completed,
      rewardCredits: rewards._sum.rewardCredits || 0,
    };
  }
}

export const referralRepository = new ReferralRepository();
