import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withListingDatabaseFixture } from '../listing-database-fixture.js';
import { ListingService } from '../../src/listings/service.js';
import { PrismaListingRepository } from '../../src/listings/repository.js';
import { completeInput } from '../completion-fixture.js';
import { aiOutput, fakeAi } from '../ai-fixture.js';
import { HttpError } from '../../src/errors.js';
import type { ListingAiClient } from '../../src/listings/ai.js';

test('Neon AI transitions preserve facts, reject stale/concurrent writes and recheck current provider without holding generation transactions',async()=>{
 await withListingDatabaseFixture(async({db,actors,listings})=>{
  const repo=new PrismaListingRepository(db),owner=actors.owner.context;
  async function validated(){
   const draft=await listings.create(owner,completeInput());
   const complete=await listings.transition(owner,draft.id,'COMPLETE',draft.etag);
   return listings.transition(owner,complete.id,'VALIDATE',complete.etag);
  }
  const denies=(code:string)=>(error:unknown)=>error instanceof HttpError&&error.code===code;
  const row=await validated();
  const before=await db.listing.findUniqueOrThrow({where:{id:row.id}});
  for(const client of [{async generate(){return 'invalid';}},{async generate(){throw new HttpError('AI_UNAVAILABLE');}}] satisfies ListingAiClient[]){
   await assert.rejects(()=>new ListingService(repo,client).aiAssist(owner,row.id,row.etag));
   assert.deepEqual(await db.listing.findUniqueOrThrow({where:{id:row.id}}),before);
  }
  await assert.rejects(()=>new ListingService(repo,fakeAi).aiAssist(actors.other.context,row.id,row.etag),denies('LISTING_NOT_FOUND'));
  for(const actor of ['admin','spare','rejected','suspended','roleless'] as const)
   await assert.rejects(()=>new ListingService(repo,fakeAi).aiAssist(actors[actor].context,row.id,row.etag),denies('FORBIDDEN'));
  let calls=0,release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const concurrent=new ListingService(repo,{async generate(){if(++calls===2)release();await gate;return JSON.stringify(aiOutput);}});
  const results=await Promise.allSettled([concurrent.aiAssist(owner,row.id,row.etag),concurrent.aiAssist(owner,row.id,row.etag)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(results.some(r=>r.status==='rejected'&&denies('PRECONDITION_FAILED')(r.reason)));
  const after=await db.listing.findUniqueOrThrow({where:{id:row.id}});
  const facts=(r:typeof after)=>{const {titleEn:_a,titleAm:_b,descriptionEn:_c,descriptionAm:_d,status:_s,updatedAt:_t,...rest}=r;return rest;};
  assert.deepEqual(facts(after),facts(before));assert.equal(after.status,'AI_ASSIST');
  assert.equal(after.descriptionAm,aiOutput.descriptionAm);assert.equal(after.publishedAt,null);
  for(const mutation of ['listing','location','provider'] as const){
   const target=await validated();
   const original=await db.listing.findUniqueOrThrow({where:{id:target.id}});
   const providerBefore=await db.provider.findUniqueOrThrow({where:{id:original.providerId}});
   const service=new ListingService(repo,{async generate(){
    // These independent database writes must finish before generate returns.
    // A transaction retained across the network phase would deadlock/time out.
    if(mutation==='listing')await db.listing.update({where:{id:target.id},data:{titleEn:'Newer title'}});
    if(mutation==='location')await db.location.update({where:{id:original.locationId!},data:{cityEn:'Newer city'}});
    if(mutation==='provider')await db.provider.update({where:{id:original.providerId},data:{status:'SUSPENDED'}});
    return JSON.stringify(aiOutput);
   }});
   try{
    await assert.rejects(()=>service.aiAssist(owner,target.id,target.etag),denies(mutation==='provider'?'FORBIDDEN':'PRECONDITION_FAILED'));
    const unchanged=await db.listing.findUniqueOrThrow({where:{id:target.id}});
    assert.equal(unchanged.status,'VALIDATE');assert.equal(unchanged.titleAm,null);
    assert.equal(unchanged.titleEn,mutation==='listing'?'Newer title':original.titleEn);
   }finally{if(mutation==='provider')await db.provider.update({where:{id:original.providerId},data:{status:'ACTIVE',updatedAt:providerBefore.updatedAt}});}
  }
  assert.equal(await db.payment.count({where:{listingId:row.id}}),0);
  assert.equal(await db.media.count({where:{listingId:row.id}}),0);
 });
});
