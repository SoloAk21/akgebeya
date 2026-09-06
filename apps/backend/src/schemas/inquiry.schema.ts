import { z } from "zod";
import { InquiryStatus } from "@prisma/client";

export const createInquirySchema = z.object({
  listingId: z.string().min(1, "Listing ID is required"),
  message: z.string().min(5, "Message must be at least 5 characters"),
  buyerPhone: z.string().min(9, "Phone number must be at least 9 characters"),
});

export const updateInquiryStatusSchema = z.object({
  status: z.nativeEnum(InquiryStatus),
  notes: z.string().optional(),
});

export type CreateInquiryInput = z.infer<typeof createInquirySchema>;
export type UpdateInquiryStatusInput = z.infer<
  typeof updateInquiryStatusSchema
>;
