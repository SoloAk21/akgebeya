import { z } from "zod";

export const generateContentInputSchema = z.object({
  prompt: z.string().min(5, "Prompt must be at least 5 characters"),
  propertyType: z.string().optional(),
  location: z.string().optional(),
  price: z.number().optional(),
});

export const bilingualListingOutputSchema = z.object({
  titleEn: z.string().min(3),
  titleAm: z.string().min(3),
  descriptionEn: z.string().min(10),
  descriptionAm: z.string().min(10),
});

export const naturalLanguageSearchInputSchema = z.object({
  query: z.string().min(3, "Search query must be at least 3 characters"),
});

export const naturalLanguageSearchOutputSchema = z.object({
  transaction: z
    .enum(["SALE", "RENT", "BUY_REQUEST", "RENT_REQUEST"])
    .optional(),
  propertyType: z.string().optional(),
  bedrooms: z.number().int().optional(),
  location: z.string().optional(),
  maxPrice: z.number().optional(),
  currency: z.string().default("ETB"),
});

export type GenerateContentInput = z.infer<typeof generateContentInputSchema>;
export type BilingualListingOutput = z.infer<
  typeof bilingualListingOutputSchema
>;
export type NaturalLanguageSearchInput = z.infer<
  typeof naturalLanguageSearchInputSchema
>;
export type NaturalLanguageSearchOutput = z.infer<
  typeof naturalLanguageSearchOutputSchema
>;
