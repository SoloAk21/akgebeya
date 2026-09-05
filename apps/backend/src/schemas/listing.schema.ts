import { z } from "zod";
import {
  PropertyCategory,
  TransactionType,
  PropertyType,
  ListingStatus,
} from "@prisma/client";

export const locationInputSchema = z.object({
  region: z.string().min(1, "Region is required"),
  city: z.string().min(1, "City is required"),
  subCity: z.string().optional(),
  woreda: z.string().optional(),
  kebele: z.string().optional(),
  neighborhood: z.string().optional(),
  streetLandmark: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const createListingSchema = z.object({
  titleEn: z.string().min(5, "English title must be at least 5 characters"),
  titleAm: z.string().min(5, "Amharic title must be at least 5 characters"),
  descriptionEn: z
    .string()
    .min(20, "English description must be at least 20 characters"),
  descriptionAm: z
    .string()
    .min(20, "Amharic description must be at least 20 characters"),
  category: z.nativeEnum(PropertyCategory),
  transaction: z.nativeEnum(TransactionType),
  propertyType: z.nativeEnum(PropertyType),
  price: z.number().positive("Price must be greater than 0"),
  areaSqM: z.number().positive().optional(),
  bedrooms: z.number().int().nonnegative().optional(),
  bathrooms: z.number().int().nonnegative().optional(),
  condition: z.string().optional(),
  amenities: z.array(z.string()).default([]),
  location: locationInputSchema,
});

export const updateListingStatusSchema = z.object({
  status: z.nativeEnum(ListingStatus),
});

export const searchListingSchema = z.object({
  category: z.nativeEnum(PropertyCategory).optional(),
  transaction: z.nativeEnum(TransactionType).optional(),
  propertyType: z.nativeEnum(PropertyType).optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  bedrooms: z.coerce.number().int().nonnegative().optional(),
  bathrooms: z.coerce.number().int().nonnegative().optional(),
  subCity: z.string().optional(),
  city: z.string().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().default(5),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export type CreateListingInput = z.infer<typeof createListingSchema>;
export type UpdateListingStatusInput = z.infer<
  typeof updateListingStatusSchema
>;
export type SearchListingInput = z.infer<typeof searchListingSchema>;
