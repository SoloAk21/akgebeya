import { listingAiInput, parseAiOutput, type ListingAiClient } from './ai.js';
import { assertComplete } from './completion.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ProviderRole } from '../generated/prisma/enums.js';
import { verifiedProviderId } from '../providers/service.js';
import type { AuthContext } from '../auth/types.js';
import { HttpError } from '../errors.js';
import { draftInput,compatible,pagination } from './input.js';
import type { DraftRecord,ListingRepository,DraftStore } from './types.js';

export const etag=(row:DraftRecord)=>'"'+createHash('sha256').update(row.id+':'+row.revision).digest('hex')+'"';
function view(row:DraftRecord){
 return {id:row.id,category:row.category,type:row.type,propertyType:row.propertyType,
 titleEn:row.titleEn,titleAm:row.titleAm,descriptionEn:row.descriptionEn,descriptionAm:row.descriptionAm,
 price:row.price?.toFixed(2)??null,currency:row.currency,bedrooms:row.bedrooms,bathrooms:row.bathrooms,
 areaSqm:row.areaSqm?.toFixed(2)??null,location:row.location,status:row.status,
 createdAt:row.createdAt,updatedAt:row.updatedAt,etag:etag(row)};
}
function precondition(id:string,match:string|undefined){
  if(!z.string().uuid().safeParse(id).success)throw new HttpError('BAD_REQUEST');
  if(match===undefined)throw new HttpError('PRECONDITION_REQUIRED');
  if(!/^"[a-f0-9]{64}"$/.test(match))throw new HttpError('BAD_REQUEST');
}
export class ListingService {
 constructor(private readonly repository:ListingRepository,private readonly ai?:ListingAiClient){}
 private run<T>(context:AuthContext,work:(store:DraftStore)=>Promise<T>){
  return this.repository.withProvider(context.user.id,async store=>{
   verifiedProviderId(context,store.provider,Object.values(ProviderRole));
   return work(store);
  });
 }
 async create(context:AuthContext,body:unknown){
  const input=draftInput.safeParse(body);if(!input.success||!compatible(input.data.category??null,input.data.propertyType??null))throw new HttpError('BAD_REQUEST');
  return this.run(context,async store=>view(await store.create(input.data)));
 }
 async get(context:AuthContext,id:string){
  if(!z.string().uuid().safeParse(id).success)throw new HttpError('BAD_REQUEST');
  return this.run(context,async store=>{const row=await store.get(id);if(!row||!['DRAFT','COMPLETE','VALIDATE','AI_ASSIST'].includes(row.status))throw new HttpError('LISTING_NOT_FOUND');return view(row);});
 }
 async mine(context:AuthContext,query:unknown){
  const input=pagination.safeParse(query);if(!input.success)throw new HttpError('BAD_REQUEST');
  return this.run(context,async store=>({listings:(await store.mine(input.data.limit,input.data.offset)).map(view),...input.data}));
 }
 async transition(context:AuthContext,id:string,target:'COMPLETE'|'VALIDATE',match:string|undefined){
  precondition(id,match);
  if(!z.enum(['COMPLETE','VALIDATE']).safeParse(target).success)throw new HttpError('BAD_REQUEST');
  return this.run(context,async store=>{
   const row=await store.get(id,true);
   if(!row)throw new HttpError('LISTING_NOT_FOUND');
   if(etag(row)!==match)throw new HttpError('PRECONDITION_FAILED');
   const expected=target==='COMPLETE'?'DRAFT':'COMPLETE';
   if(row.status!==expected||row.publishedAt!==null||row._count.payments>0||row._count.media>0)
    throw new HttpError('LISTING_TRANSITION_CONFLICT');
   assertComplete(row);
   return view(await store.transition(row,target));
  });
 }
 async aiAssist(context:AuthContext,id:string,match:string|undefined){
  precondition(id,match);
  const check=(row:DraftRecord|null):DraftRecord=>{
   if(!row)throw new HttpError('LISTING_NOT_FOUND');
   if(etag(row)!==match)throw new HttpError('PRECONDITION_FAILED');
   if(row.status!=='VALIDATE'||row.publishedAt!==null||row._count.payments>0||row._count.media>0)
    throw new HttpError('LISTING_TRANSITION_CONFLICT');
   assertComplete(row);
   return row;
  };
  const snapshot=await this.run(context,async store=>{
   const row=check(await store.get(id,true)),input=listingAiInput(row);
   return {input,source:JSON.stringify(input)};
  });
  // The provider/listing transaction has committed before this network call.
  if(!this.ai)throw new HttpError('AI_UNAVAILABLE');
  let raw:unknown;
  try{raw=await this.ai.generate(snapshot.input);}
  catch(error){
   if(error instanceof HttpError&&['AI_UNAVAILABLE','AI_TIMEOUT','AI_RATE_LIMITED','AI_OUTPUT_INVALID'].includes(error.code))throw error;
   throw new HttpError('AI_UNAVAILABLE');
  }
  const output=parseAiOutput(raw);
  return this.run(context,async store=>{
   const row=check(await store.get(id,true));
   // A shared location can change without changing the listing revision.
   if(JSON.stringify(listingAiInput(row))!==snapshot.source)throw new HttpError('PRECONDITION_FAILED');
   return view(await store.saveAi(row,output));
  });
 }
 async update(context:AuthContext,id:string,body:unknown,match:string|undefined,remove=false){
  precondition(id,match);
  const input=draftInput.safeParse(body);
  if(!input.success||(!remove&&Object.keys(input.data).length===0)||(remove&&Object.keys(input.data).length!==0))throw new HttpError('BAD_REQUEST');
  return this.run(context,async store=>{
   const row=await store.get(id,true);if(!row)throw new HttpError('LISTING_NOT_FOUND');
   if(row.status!=='DRAFT'||row.publishedAt!==null||row._count.payments>0||row._count.media>0)throw new HttpError('LISTING_CONFLICT');
   if(etag(row)!==match)throw new HttpError('PRECONDITION_FAILED');
   const category=input.data.category===undefined?row.category:input.data.category;
   const propertyType=input.data.propertyType===undefined?row.propertyType:input.data.propertyType;
   if(!compatible(category,propertyType))throw new HttpError('BAD_REQUEST');
   return view(await store.update(row,input.data,remove));
  });
 }
}
