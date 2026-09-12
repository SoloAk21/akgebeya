import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { HttpError } from '../src/errors.js';
import { compatible,draftInput,categoryTypes } from '../src/listings/input.js';
import { listingFixture } from './listing-fixture.js';
import { withServer } from './helpers.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
test('draft validation accepts partials and approved taxonomy; rejects invalid values and lifecycle/ownership injection',()=>{
 assert.ok(draftInput.safeParse({}).success);
 for(const [category,types]of Object.entries(categoryTypes))for(const type of types){
  assert.ok(draftInput.safeParse({category,propertyType:type}).success);
  assert.ok(compatible(category as keyof typeof categoryTypes,type));
 }
 for(const input of [{category:'INVALID'},{type:'INVALID'},{propertyType:'LAND'},{propertyType:'G+1'},{titleEn:' \n'},
  {price:0},{price:'NaN'},{price:'0'},{price:'1.001'},{areaSqm:'-1'},{bedrooms:-1},{bathrooms:32768},{providerId:'x'},{userId:'x'},{paymentState:'PAID'},
  ...['DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW','CALCULATE_FEE','PAYMENT','VERIFY_PAYMENT','PUBLISHED'].map(status=>({status}))])assert.equal(draftInput.safeParse(input).success,false);
});
test('draft empty creation, incremental bilingual updates, ownership, listing mine and stale concurrent edits',async()=>{
 const f=await listingFixture(),s=f.listingService;
 const row=await s.create(f.context,{});
 assert.equal(row.status,'DRAFT');assert.equal(row.price,null);assert.equal(row.titleEn,null);assert.equal(row.location,null);
 assert.equal((await s.mine(f.context,{})).listings.length,1);
 assert.equal((await s.mine(f.otherContext,{})).listings.length,0);
 await assert.rejects(()=>s.get(f.otherContext,row.id),denied('LISTING_NOT_FOUND'));
 await assert.rejects(()=>s.update(f.otherContext,row.id,{titleEn:'Wrong'},row.etag),denied('LISTING_NOT_FOUND'));
 const result=await Promise.allSettled([
  s.update(f.context,row.id,{titleEn:'First',titleAm:'\u1264\u1275'},row.etag),
  s.update(f.context,row.id,{titleEn:'Second'},row.etag),
 ]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(result.filter(r=>r.status==='rejected').every(r=>denied('PRECONDITION_FAILED')(r.reason)));
 const current=await s.get(f.context,row.id);assert.equal(current.titleEn,'First');assert.equal(current.titleAm,'\u1264\u1275');
 await assert.rejects(()=>s.update(f.context,row.id,{titleEn:'Lost'},row.etag),denied('PRECONDITION_FAILED'));
 await assert.rejects(()=>s.update(f.context,row.id,{titleEn:'No precondition'},undefined),denied('PRECONDITION_REQUIRED'));
});
test('draft merged compatibility, non-DRAFT protection, dependent records and soft deletion',async()=>{
 const f=await listingFixture(),s=f.listingService;
 const row=await s.create(f.context,{category:'RESIDENTIAL',propertyType:'HOUSE'});
 await assert.rejects(()=>s.update(f.context,row.id,{category:'LAND'},row.etag),denied('BAD_REQUEST'));
 let current=await s.update(f.context,row.id,{category:'LAND',propertyType:'RESIDENTIAL_LAND'},row.etag);
 f.rows.get(row.id)!.status='PAUSED';
 await assert.rejects(()=>s.update(f.context,row.id,{titleEn:'No'},current.etag),denied('LISTING_CONFLICT'));
 await assert.rejects(()=>s.get(f.context,row.id),denied('LISTING_NOT_FOUND'));
 f.rows.get(row.id)!.status='DRAFT';f.rows.get(row.id)!._count.payments=1;
 await assert.rejects(()=>s.update(f.context,row.id,{},current.etag,true),denied('LISTING_CONFLICT'));
 f.rows.get(row.id)!._count.payments=0;
 await s.update(f.context,row.id,{},current.etag,true);
 assert.equal(f.rows.get(row.id)!.status,'DRAFT');assert.ok(f.rows.get(row.id)!.deletedAt);
 await assert.rejects(()=>s.get(f.context,row.id),denied('LISTING_NOT_FOUND'));
 await assert.rejects(()=>s.update(f.context,row.id,{titleEn:'No'},current.etag),denied('LISTING_NOT_FOUND'));
 assert.equal((await s.mine(f.context,{})).listings.length,0);
});
test('draft service denies unverified/rejected/suspended/roleless providers and users without a provider',async()=>{
 const f=await listingFixture(),s=f.listingService;const p=f.records.get(f.ownerProvider.id)!;
 await assert.rejects(()=>s.create(f.adminContext,{}),denied('FORBIDDEN'));
 for(const state of ['UNVERIFIED','REJECTED','SUSPENDED','ROLELESS']){
  const old={role:p.role,status:p.status,review:p.review};
  if(state==='UNVERIFIED')p.review=null;if(state==='REJECTED')p.review={...p.review!,status:'REJECTED'};
  if(state==='SUSPENDED')p.status='SUSPENDED';if(state==='ROLELESS')p.role=null;
  await assert.rejects(()=>s.create(f.context,{}),denied('FORBIDDEN'));
  Object.assign(p,old);
 }
});
test('draft HTTP requires auth, validates requests, exposes ETag and rejects missing/weak/stale preconditions',async()=>{
 const f=await listingFixture();const app=createApp(parseConfig({}),f.service,undefined,undefined,undefined,f.providerService,f.listingService);
 await withServer(app,async base=>{
  const url=base+'/api/v1/listings';
  let r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(r.status,401);await r.arrayBuffer();
  const token=(await f.service.createSessionForVerifiedUser(f.user.id)).token;
  const headers={authorization:'Bearer '+token,'content-type':'application/json'};
  r=await fetch(url,{method:'POST',headers,body:'{}'});assert.equal(r.status,201);assert.equal(r.headers.get('cache-control'),'no-store');
  const body=await r.json() as {listing:{id:string;etag:string}};assert.equal(r.headers.get('etag'),body.listing.etag);
  const target=url+'/'+body.listing.id;
  for(const [match,status]of [[undefined,428],['*',400],['W/'+body.listing.etag,400]] as const){
   r=await fetch(target,{method:'PATCH',headers:{...headers,...(match?{'if-match':match}:{})},body:'{"titleEn":"Edit"}'});
   assert.equal(r.status,status);await r.arrayBuffer();
  }
  r=await fetch(target,{method:'PATCH',headers:{...headers,'if-match':body.listing.etag},body:'{"status":"PUBLISHED"}'});assert.equal(r.status,400);await r.arrayBuffer();
  r=await fetch(url+'/mine?limit=0',{headers});assert.equal(r.status,400);await r.arrayBuffer();
  r=await fetch(target,{method:'DELETE',headers:{...headers,'if-match':body.listing.etag}});assert.equal(r.status,200);await r.arrayBuffer();
  r=await fetch(target,{headers});assert.equal(r.status,404);await r.arrayBuffer();
 });
});
