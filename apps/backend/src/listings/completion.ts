import { draftInput,locationInput,compatible } from './input.js';
import { ListingIncompleteError,type ListingValidationField } from '../errors.js';
import type { DraftRecord } from './types.js';
export function assertComplete(row:DraftRecord,preview=false):void {
 const fields=new Set<ListingValidationField>();
 for(const key of ['category','type','propertyType','titleEn','descriptionEn'] as const)
  if(row[key]===null||!draftInput.shape[key].safeParse(row[key]).success)fields.add(key);
 if(!fields.has('category')&&!fields.has('propertyType')&&!compatible(row.category,row.propertyType))fields.add('propertyType');
 for(const key of ['titleAm','descriptionAm','bedrooms','bathrooms'] as const)
  if(!draftInput.shape[key].safeParse(row[key]).success)fields.add(key);
 if(row.price===null||!draftInput.shape.price.safeParse(row.price.toFixed()).success)fields.add('price');
 if(row.areaSqm!==null&&!draftInput.shape.areaSqm.safeParse(row.areaSqm.toFixed()).success)fields.add('areaSqm');
 if(row.currency!=='ETB')fields.add('currency');
 const location=row.location;
 if(!row.locationId||!location||location.id!==row.locationId)fields.add('locationId');
 else {
  const {countryCode,regionEn,regionAm,cityEn,cityAm,subcityEn,subcityAm,addressEn,addressAm}=location;
  if(!locationInput.safeParse({countryCode,regionEn,regionAm,cityEn,cityAm,subcityEn,subcityAm,addressEn,addressAm}).success)fields.add('locationId');
 }
 if(preview){
  for(const key of ['titleAm','descriptionAm'] as const)if(row[key]===null)fields.add(key);
  if(row.publishedAt!==null)fields.add('publishedAt');
 }
 if(fields.size)throw new ListingIncompleteError([...fields]);
}
