import { z } from "zod";
import { ProviderType } from "@prisma/client";

export const createProviderSchema = z.object({
  type: z.nativeEnum(ProviderType, {
    message: "Invalid provider type",
  }),
  businessName: z.string().optional(),
  phone: z.string().min(9, "Phone number must be at least 9 characters"),
  whatsapp: z.string().optional(),
  bio: z.string().max(1000).optional(),
  publicProfileUrl: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/, {
      message:
        "Profile URL can only contain letters, numbers, underscores, and hyphens",
    })
    .optional(),
});

export const submitVerificationSchema = z.object({
  documentType: z.string().min(2, "Document type is required"),
  documentUrl: z.string().url("Invalid document URL"),
});

export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type SubmitVerificationInput = z.infer<typeof submitVerificationSchema>;
