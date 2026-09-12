import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma/client.js';
import { providerFixture } from './provider-fixture.js';
import { ListingService } from '../src/listings/service.js';
import type { DraftRecord,ListingRepository } from '../src/listings/types.js';
export async function listingFixture(){
 const f=providerFixture();const p=await f.providerService.create(f.context,{role:'OWNER',nameEn:'Draft owner'});
 const v=await f.providerService.submit(f.context);await f.providerService.decide(f.adminContext,p.id,{verificationId:v.id},true);
 const other=await f.providerService.create(f.otherContext,{role:'BROKER',nameEn:'Other'});
 const ov=await f.providerService.submit(f.otherContext);await f.providerService.decide(f.adminContext,other.id,{verificationId:ov.id},true);
 const rows=new Map<string,DraftRecord>();let sequence=0;let queue=Promise.resolve();
 const repository:ListingRepository={
  withProvider(userId,run){
   const work=queue.then(async()=>{
    const provider=[...f.records.values()].find(p=>p.userId===userId)??null;
    return run({provider,
     async create(input){
      const row:DraftRecord={id:randomUUID(),providerId:provider!.id,category:null,type:null,propertyType:null,titleEn:null,titleAm:null,descriptionEn:null,descriptionAm:null,
       price:null,areaSqm:null,bedrooms:null,bathrooms:null,locationId:null,location:null,currency:'ETB',status:'DRAFT',publishedAt:null,deletedAt:null,
       createdAt:new Date(),updatedAt:new Date(),_count:{payments:0,media:0},revision:String(++sequence)};
      const {location:_location,price,areaSqm,...rest}=input;Object.assign(row,rest);
      if(price!=null)row.price=new Prisma.Decimal(price);if(areaSqm!=null)row.areaSqm=new Prisma.Decimal(areaSqm);
      rows.set(row.id,row);return row;
     },
     async get(id){const r=rows.get(id);return r&&r.providerId===provider?.id&&!r.deletedAt?r:null;},
     async mine(limit,offset){return [...rows.values()].filter(r=>r.providerId===provider?.id&&!r.deletedAt&&r.status==='DRAFT').slice(offset,offset+limit);},
     async transition(row,target){row.status=target;row.revision=String(++sequence);return row;},
     async update(row,input,remove){
      const {location:_location,price,areaSqm,...rest}=input;Object.assign(row,rest);
      if(price!==undefined)row.price=price===null?null:new Prisma.Decimal(price);
      if(areaSqm!==undefined)row.areaSqm=areaSqm===null?null:new Prisma.Decimal(areaSqm);
      if(remove)row.deletedAt=new Date();row.revision=String(++sequence);return row;
     },
    });
   });
   queue=work.then(()=>{},()=>{});return work;
  },
 };
 return {...f,rows,ownerProvider:p,listingService:new ListingService(repository)};
}
