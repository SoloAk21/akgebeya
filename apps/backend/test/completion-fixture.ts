import { randomUUID } from 'node:crypto';
import { listingFixture } from './listing-fixture.js';
import type { DraftInput } from '../src/listings/input.js';
export const completeInput=(category:'RESIDENTIAL'|'COMMERCIAL'|'LAND'='RESIDENTIAL'):DraftInput=>({
 category,type:'SALE',propertyType:category==='RESIDENTIAL'?'HOUSE':category==='COMMERCIAL'?'OFFICE':'RESIDENTIAL_LAND',
 titleEn:'Completion fixture',descriptionEn:'Private completion verification fixture',price:'100.00',
 location:{regionEn:'Addis Ababa',cityEn:'Addis Ababa'},
});
export async function completionFixture(){
 const f=await listingFixture();
 const result=await f.listingService.create(f.context,completeInput());
 const row=f.rows.get(result.id)!;
 const id=randomUUID();
 row.locationId=id;row.location={id,countryCode:'ET',regionEn:'Addis Ababa',cityEn:'Addis Ababa',regionAm:null,cityAm:null,subcityEn:null,subcityAm:null,addressEn:null,addressAm:null,createdAt:new Date(),updatedAt:new Date()};
 return {...f,row,result};
}
