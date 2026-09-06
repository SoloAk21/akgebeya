import { z } from "zod";

export const generateLeaseSchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
  landlordName: z.string().min(2, "Landlord name is required"),
  tenantName: z.string().min(2, "Tenant name is required"),
  brokerName: z.string().optional(),
  monthlyRent: z.number().positive("Monthly rent must be greater than 0"),
  depositAmount: z.number().nonnegative("Deposit amount must be non-negative"),
  startDate: z.string().min(8, "Start date is required"),
  durationMonths: z
    .number()
    .int()
    .positive("Duration must be at least 1 month"),
  termsEn: z.string().optional(),
  termsAm: z.string().optional(),
});

export type GenerateLeaseInput = z.infer<typeof generateLeaseSchema>;
