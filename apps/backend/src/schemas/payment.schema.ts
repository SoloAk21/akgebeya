import { z } from "zod";

export const initializePaymentSchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
  amount: z.number().positive("Amount must be greater than 0"),
  email: z.string().email("Valid email is required"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});

export const chapaWebhookSchema = z.object({
  event: z.string().optional(),
  tx_ref: z.string().min(1, "Transaction reference is required"),
  reference: z.string().optional(),
  status: z.string().min(1, "Status is required"),
  amount: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
});

export type InitializePaymentInput = z.infer<typeof initializePaymentSchema>;
export type ChapaWebhookInput = z.infer<typeof chapaWebhookSchema>;
