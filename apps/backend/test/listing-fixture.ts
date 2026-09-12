import { randomUUID } from 'node:crypto';
import { Prisma,type ListingFeeQuote,type Payment } from '../src/generated/prisma/client.js';
import { providerFixture } from './provider-fixture.js';
import { ListingService } from '../src/listings/service.js';
import type { DraftRecord,ListingRepository } from '../src/listings/types.js';
import type { ListingAiClient } from '../src/listings/ai.js';
export async function listingFixture(ai?:ListingAiClient,chapa?:import('../src/payments/client.js').ChapaClient){
 const f=providerFixture();const p=await f.providerService.create(f.context,{role:'OWNER',nameEn:'Draft owner'});
 const v=await f.providerService.submit(f.context);await f.providerService.decide(f.adminContext,p.id,{verificationId:v.id},true);
 const other=await f.providerService.create(f.otherContext,{role:'BROKER',nameEn:'Other'});
 const ov=await f.providerService.submit(f.otherContext);await f.providerService.decide(f.adminContext,other.id,{verificationId:ov.id},true);
 const payments=new Map<string,Payment>();
 const quotes=new Map<string,ListingFeeQuote>();
 const rows=new Map<string,DraftRecord>();let sequence=0;let queue=Promise.resolve();
 const repository:ListingRepository={
  async recordPaymentFailure(id,outcome){const p=payments.get(id);if(p?.initializationStatus==='RESERVED'){p.initializationStatus=outcome;p.status=outcome==='REJECTED'?'FAILED':'PENDING';}},
  withProvider(userId,run){
   const work=queue.then(async()=>{
    const provider=[...f.records.values()].find(p=>p.userId===userId)??null;
    return run({provider,
     async findPayment(id){return [...payments.values()].find(p=>p.listingId===id)??null;},
     async settlePayment(id,status){const p=payments.get(id)!;if(p.status!=='SUCCEEDED'){p.status=status;p.paidAt=status==='SUCCEEDED'?new Date():null;}return p;},
     async publish(row){row.status='PUBLISHED';row.publishedAt=new Date();row.revision=String(++sequence);return row;},
     async reservePayment(input){const p:Payment={...input,id:randomUUID(),gateway:'CHAPA',status:'PENDING',initializationStatus:'RESERVED',checkoutUrl:null,paidAt:null,refundedAmountMinor:0n,createdAt:new Date(),updatedAt:new Date()};payments.set(p.id,p);rows.get(input.listingId!)!._count.payments++;return {...p};},
     async initializePayment(id,url){Object.assign(payments.get(id)!,{initializationStatus:'INITIALIZED',checkoutUrl:url});},
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
     async findFeeQuote(id){return rows.get(id)?.providerId===provider?.id?quotes.get(id)??null:null;},
     async createFeeQuote(row,fee,sourceRevision){
      if(quotes.has(row.id))throw new Error('Duplicate quote');
      const quote={id:randomUUID(),listingId:row.id,...fee,sourceRevision,calculatedAt:new Date(),createdAt:new Date()};quotes.set(row.id,quote);return quote;
     },
     async saveAi(row,output){Object.assign(row,output);row.status='AI_ASSIST';row.revision=String(++sequence);return row;},
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
 return {...f,rows,quotes,payments,repository,ownerProvider:p,listingService:new ListingService(repository,ai,chapa)};
}
