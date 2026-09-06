import { z } from "zod";

export const applyReferralCodeSchema = z.object({
  code: z
    .string()
    .min(6, "Referral code must be at least 6 characters")
    .max(20, "Referral code must not exceed 20 characters")
    .transform((val) => val.trim().toUpperCase()),
});

export type ApplyReferralCodeInput = z.infer<typeof applyReferralCodeSchema>;
