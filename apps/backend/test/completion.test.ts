import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma/client.js';
import { ListingIncompleteError,HttpError,type ListingValidationField } from '../src/errors.js';
import { assertComplete } from '../src/listings/completion.js';
import { etag } from '../src/listings/service.js';
import { completionFixture } from './completion-fixture.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { withServer } from './helpers.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
test('completion reports safe fields for missing, incompatible and invalid stored data without requiring optional property fields',async()=>{
 const {row}=await completionFixture();
 assert.doesNotThrow(()=>assertComplete(row));
 for(const key of ['category','type','propertyType','titleEn','descriptionEn','locationId','price'] as const){
  assert.throws(()=>assertComplete({...row,[key]:null}),e=>e instanceof ListingIncompleteError&&e.fields.includes(key));
 }
 for(const [patch,field]of [
  [{category:'LAND'},'propertyType'],[{type:'UNKNOWN'},'type'],[{propertyType:'OTHER'},'propertyType'],
  [{titleEn:' \t'},'titleEn'],[{descriptionEn:''},'descriptionEn'],
  [{location:null},'locationId'],[{location:{...row.location,id:randomUUID()}},'locationId'],
  [{location:{...row.location,countryCode:'US'}},'locationId'],[{location:{...row.location,regionEn:''}},'locationId'],
  ...['0','-1','NaN','Infinity'].map(price=>[{price:new Prisma.Decimal(price)},'price']),
  [{currency:'USD'},'currency'],[{bedrooms:-1},'bedrooms'],[{bathrooms:32768},'bathrooms'],
  [{areaSqm:new Prisma.Decimal('0')},'areaSqm'],[{titleAm:' '},'titleAm'],
 ] as const)assert.throws(()=>assertComplete(Object.assign({...row},patch)),e=>e instanceof ListingIncompleteError&&e.fields.includes(field as ListingValidationField));
 for(const [category,propertyType]of [['RESIDENTIAL','HOUSE'],['COMMERCIAL','OFFICE'],['LAND','RESIDENTIAL_LAND']] as const)
  assert.doesNotThrow(()=>assertComplete({...row,category,propertyType,titleAm:null,descriptionAm:null,bedrooms:null,bathrooms:null,areaSqm:null}));
 const safe=new ListingIncompleteError(['titleEn','private-fixture-value' as ListingValidationField]);
 assert.deepEqual(safe.fields,['titleEn']);
});
test('completion state machine and ETags reject skips, repeats, reverse/future transitions and simultaneous edits',async()=>{
 const f=await completionFixture(),s=f.listingService,id=f.row.id;
 await assert.rejects(()=>s.transition(f.context,id,'COMPLETE',undefined),denied('PRECONDITION_REQUIRED'));
 for(const match of ['*','W/'+etag(f.row),'"bad"'])await assert.rejects(()=>s.transition(f.context,id,'COMPLETE',match),denied('BAD_REQUEST'));
 await assert.rejects(()=>s.transition(f.context,id,'VALIDATE',etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));
 for(const target of ['COMPLETE','VALIDATE'] as const){
  const revision=etag(f.row);
  const outcomes=await Promise.allSettled([s.transition(f.context,id,target,revision),s.transition(f.context,id,target,revision)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(outcomes.filter(r=>r.status==='rejected').every(r=>denied('PRECONDITION_FAILED')(r.reason)));
  assert.equal(f.row.status,target);
  await assert.rejects(()=>s.transition(f.context,id,target,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));
  await assert.rejects(()=>s.update(f.context,id,{status:'DRAFT'},etag(f.row)),denied('BAD_REQUEST'));
 }
 await assert.rejects(()=>s.transition(f.context,id,'COMPLETE',etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));
 await assert.rejects(()=>s.transition(f.context,id,'PUBLISHED' as 'COMPLETE',etag(f.row)),denied('BAD_REQUEST'));
 assert.equal((await s.get(f.context,id)).status,'VALIDATE');
 assert.equal((await s.mine(f.context,{})).listings.length,0);
 assert.equal(f.row.providerId,f.ownerProvider.id);assert.equal(f.row.publishedAt,null);
});
test('validation rechecks COMPLETE data and provider authorization; rejected actions preserve state and revision',async()=>{
 const f=await completionFixture(),s=f.listingService,id=f.row.id;
 await assert.rejects(()=>s.transition(f.otherContext,id,'COMPLETE',etag(f.row)),denied('LISTING_NOT_FOUND'));
 await assert.rejects(()=>s.transition(f.adminContext,id,'COMPLETE',etag(f.row)),denied('FORBIDDEN'));
 const provider=f.records.get(f.ownerProvider.id)!;
 for(const target of ['COMPLETE','VALIDATE'] as const){
  f.row.status=target==='COMPLETE'?'DRAFT':'COMPLETE';
  const revision=etag(f.row);
  for(const patch of [{review:null},{review:{...provider.review!,status:'REJECTED' as const}},{status:'SUSPENDED' as const},{role:null}]){
   const before={...provider};Object.assign(provider,patch);
   await assert.rejects(()=>s.transition(f.context,id,target,revision),denied('FORBIDDEN'));
   Object.assign(provider,before);
  }
  const title=f.row.titleEn;f.row.titleEn=null;
  await assert.rejects(()=>s.transition(f.context,id,target,revision),denied('LISTING_INCOMPLETE'));
  assert.equal(etag(f.row),revision);assert.equal(f.row.status,target==='COMPLETE'?'DRAFT':'COMPLETE');f.row.titleEn=title;
  f.row.deletedAt=new Date();await assert.rejects(()=>s.transition(f.context,id,target,revision),denied('LISTING_NOT_FOUND'));f.row.deletedAt=null;
 }
});
test('completion HTTP enforces auth, private errors, strict action bodies, no-store, ETags and PATCH lifecycle rejection',async()=>{
 const f=await completionFixture();
 const app=createApp(parseConfig({}),f.service,undefined,undefined,undefined,f.providerService,f.listingService);
 await withServer(app,async base=>{
  const url=base+'/api/v1/listings/'+f.row.id;
  let r=await fetch(url+'/complete',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,401);await r.arrayBuffer();
  const token=(await f.service.createSessionForVerifiedUser(f.user.id)).token;
  const headers={authorization:'Bearer '+token,'content-type':'application/json','if-match':etag(f.row)};
  for(const body of ['{"status":"COMPLETE"}','{"providerId":"injected"}','[]','null']){
   r=await fetch(url+'/complete',{method:'POST',headers,body});assert.equal(r.status,400);await r.arrayBuffer();
  }
  f.row.titleEn=null;
  r=await fetch(url+'/complete',{method:'POST',headers,body:'{}'});assert.equal(r.status,422);
  assert.deepEqual(await r.json(),{error:{code:'LISTING_INCOMPLETE',message:'Listing information is incomplete or invalid',fields:['titleEn']}});
  assert.equal(f.row.status,'DRAFT');f.row.titleEn='Restored title';
  for(const action of ['complete','validate']){
   r=await fetch(url+'/'+action,{method:'POST',headers:{...headers,'if-match':etag(f.row)},body:'{}'});
   assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
   const body=await r.json() as {listing:{etag:string}};assert.equal(r.headers.get('etag'),body.listing.etag);
  }
  for(const status of ['DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PUBLISHED']){
   r=await fetch(url,{method:'PATCH',headers:{...headers,'if-match':etag(f.row)},body:JSON.stringify({status})});assert.equal(r.status,400);await r.arrayBuffer();
  }
 });
});
