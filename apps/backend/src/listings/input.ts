import { z } from 'zod';
import { PropertyCategory, PropertyType, ListingType } from '../generated/prisma/enums.js';
export const categoryTypes = {
 RESIDENTIAL:['STUDIO','APARTMENT','CONDOMINIUM','VILLA','HOUSE','G_PLUS_1','G_PLUS_2'],
 COMMERCIAL:['OFFICE','SHOP','WAREHOUSE','BUILDING','HOTEL'],
 LAND:['INDUSTRIAL_LAND','AGRICULTURAL_LAND','RESIDENTIAL_LAND','COMMERCIAL_LAND'],
} as const;
const text=(max:number)=>z.string().trim().min(1).max(max).refine(v=>!/\p{Cc}/u.test(v));
const decimal=(digits:number)=>z.string().regex(new RegExp('^(?:0|[1-9][0-9]{0,'+(digits-1)+'})(?:\\.[0-9]{1,2})?$')).refine(v=>Number(v)>0);
export const locationInput=z.object({
 countryCode:z.literal('ET').optional(),regionEn:text(120),cityEn:text(120),
 regionAm:text(120).nullable().optional(),cityAm:text(120).nullable().optional(),
 subcityEn:text(120).nullable().optional(),subcityAm:text(120).nullable().optional(),
 addressEn:text(500).nullable().optional(),addressAm:text(500).nullable().optional(),
}).strict();
export const draftInput=z.object({
 category:z.enum(PropertyCategory).nullable().optional(),type:z.enum(ListingType).nullable().optional(),
 propertyType:z.enum(PropertyType).nullable().optional(),
 titleEn:text(200).nullable().optional(),titleAm:text(200).nullable().optional(),
 descriptionEn:text(10000).nullable().optional(),descriptionAm:text(10000).nullable().optional(),
 price:decimal(16).nullable().optional(),areaSqm:decimal(10).nullable().optional(),
 bedrooms:z.number().int().min(0).max(32767).nullable().optional(),
 bathrooms:z.number().int().min(0).max(32767).nullable().optional(),
 location:locationInput.nullable().optional(),
}).strict();
export type DraftInput=z.infer<typeof draftInput>;
export function compatible(category:PropertyCategory|null,propertyType:PropertyType|null) {
 return propertyType===null || (category!==null && (categoryTypes[category] as readonly string[]).includes(propertyType));
}
export const pagination=z.object({limit:z.coerce.number().int().min(1).max(50).default(20),offset:z.coerce.number().int().min(0).max(10000).default(0)}).strict();
