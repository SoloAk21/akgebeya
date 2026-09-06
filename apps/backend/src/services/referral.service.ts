import {
  referralRepository,
  ReferralRepository,
} from "../repositories/referral.repository";
import { ApplyReferralCodeInput } from "../schemas/referral.schema";
import { Referral } from "@prisma/client";

export class ReferralService {
  constructor(private referralRepo: ReferralRepository = referralRepository) {}

  async getUserReferralCode(
    userId: string,
  ): Promise<{ referralCode: string; shareUrl: string }> {
    const referralCode =
      await this.referralRepo.getOrCreateReferralCode(userId);
    const shareUrl = `https://t.me/AkGebeyaBot?start=ref_${referralCode}`;

    return { referralCode, shareUrl };
  }

  async applyReferralCode(
    referredUserId: string,
    input: ApplyReferralCodeInput,
  ): Promise<Referral> {
    return this.referralRepo.applyReferralCode(referredUserId, input.code);
  }

  async getReferralDashboard(userId: string): Promise<{
    referralCode: string;
    shareUrl: string;
    totalInvited: number;
    completed: number;
    rewardCredits: number;
  }> {
    const stats = await this.referralRepo.getReferralStats(userId);
    const shareUrl = `https://t.me/AkGebeyaBot?start=ref_${stats.referralCode}`;

    return {
      ...stats,
      shareUrl,
    };
  }
}

export const referralService = new ReferralService();
