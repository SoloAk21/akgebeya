import { z } from "zod";
import { VerificationStatus } from "@prisma/client";

export const reportListingSchema = z.object({
  reason: z.string().min(3, "Reason must be at least 3 characters"),
  details: z.string().optional(),
});

export const moderateListingSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().optional(),
});

export const reviewVerificationSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  rejectionReason: z.string().optional(),
});

export type ReportListingInput = z.infer<typeof reportListingSchema>;
export type ModerateListingInput = z.infer<typeof moderateListingSchema>;
export type ReviewVerificationInput = z.infer<typeof reviewVerificationSchema>;
