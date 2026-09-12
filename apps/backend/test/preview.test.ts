import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Prisma } from '../src/generated/prisma/client.js';
import { HttpError,ListingIncompleteError } from '../src/errors.js';
import { etag } from '../src/listings/service.js';
import { aiFixture,aiOutput } from './ai-fixture.js';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { withServer } from './helpers.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
async function fixture(){
 let calls=0;const f=await aiFixture({async generate(){calls++;throw new Error('Unexpected AI call');}});
 Object.assign(f.row,aiOutput,{status:'AI_ASSIST'});return {...f,calls:()=>calls};
}
test('preview enforces current provider authorization, private ownership, deletion and exact source state',async()=>{
 const f=await fixture(),s=f.listingService,id=f.row.id,p=f.records.get(f.ownerProvider.id)!;
 await assert.rejects(()=>s.preview(f.otherContext,id,etag(f.row)),denied('LISTING_NOT_FOUND'));
 await assert.rejects(()=>s.preview(f.adminContext,id,etag(f.row)),denied('FORBIDDEN'));
 for(const patch of [{review:null},{review:{...p.review!,status:'REJECTED' as const}},{status:'SUSPENDED' as const},{status:'INACTIVE' as const},{role:null}]){
  const before={...p};Object.assign(p,patch);await assert.rejects(()=>s.preview(f.context,id,etag(f.row)),denied('FORBIDDEN'));Object.assign(p,before);
 }
 f.row.deletedAt=new Date();await assert.rejects(()=>s.preview(f.context,id,etag(f.row)),denied('LISTING_NOT_FOUND'));f.row.deletedAt=null;
 for(const status of ['DRAFT','COMPLETE','VALIDATE','PREVIEW','PUBLISHED','PAUSED','ARCHIVED'] as const){
  f.row.status=status;const before=JSON.stringify(f.row);await assert.rejects(()=>s.preview(f.context,id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));assert.equal(JSON.stringify(f.row),before);
 }
 assert.equal(f.calls(),0);
});
test('preview revalidates every required field and optional numeric constraints without partial mutation',async()=>{
 const f=await fixture(),s=f.listingService,id=f.row.id;
 const patches=[...['category','type','propertyType','titleEn','descriptionEn','titleAm','descriptionAm','locationId','price'].map(key=>({[key]:null})),
  {category:'LAND'}, {location:null},{location:{...f.row.location,countryCode:'US'}},
  ...['titleEn','titleAm','descriptionEn','descriptionAm'].map(key=>({[key]:'  '})),
  ...['0','-1','NaN','Infinity'].map(value=>({price:new Prisma.Decimal(value)})),
  {currency:'USD'},{bedrooms:-1},{bathrooms:32768},{areaSqm:new Prisma.Decimal('0')},{publishedAt:new Date()}];
 for(const patch of patches){
  const previous={...f.row};Object.assign(f.row,patch);const before=JSON.stringify(f.row);
  await assert.rejects(()=>s.preview(f.context,id,etag(f.row)),e=>e instanceof ListingIncompleteError&&e.fields.length>0);
  assert.equal(JSON.stringify(f.row),before);Object.assign(f.row,previous);
 }
 assert.equal(f.calls(),0);
});
test('preview requires ETag and concurrent requests change only status and revision exactly once',async()=>{
 const f=await fixture(),s=f.listingService,id=f.row.id;
 await assert.rejects(()=>s.preview(f.context,id,undefined),denied('PRECONDITION_REQUIRED'));
 for(const match of ['*','bad','W/'+etag(f.row)])await assert.rejects(()=>s.preview(f.context,id,match),denied('BAD_REQUEST'));
 await assert.rejects(()=>s.preview(f.context,id,'"'+'0'.repeat(64)+'"'),denied('PRECONDITION_FAILED'));
 const before={...f.row},match=etag(f.row);
 const outcomes=await Promise.allSettled([s.preview(f.context,id,match),s.preview(f.context,id,match)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
 assert.ok(outcomes.some(x=>x.status==='rejected'&&denied('PRECONDITION_FAILED')(x.reason)));
 const {status:_s,updatedAt:_u,revision:_r,...facts}=f.row;
 const {status:_bs,updatedAt:_bu,revision:_br,...old}=before;assert.deepEqual(facts,old);
 assert.equal(f.row.status,'PREVIEW');assert.equal(f.row.publishedAt,null);assert.deepEqual(f.row._count,{payments:0,media:0});
 const result=await s.get(f.context,id);assert.equal(result.status,'PREVIEW');
 assert.equal(f.calls(),0);await assert.rejects(()=>s.preview(f.context,id,result.etag),denied('LISTING_TRANSITION_CONFLICT'));
 await assert.rejects(()=>s.get(f.otherContext,id),denied('LISTING_NOT_FOUND'));
});
test('preview returns only allowlisted provider/location data and preserves existing media without AI',async()=>{
 const f=await fixture();f.row._count.media=1;
 const result=await f.listingService.preview(f.context,f.row.id,etag(f.row));
 assert.deepEqual(Object.keys(result.provider).sort(),['id','role','nameEn','nameAm'].sort());
 assert.deepEqual(Object.keys(result.location!).sort(),['id','countryCode','regionEn','regionAm','cityEn','cityAm','subcityEn','subcityAm','addressEn','addressAm'].sort());
 for(const key of ['titleEn','titleAm','descriptionEn','descriptionAm'] as const)assert.equal(result[key],aiOutput[key]);
 const json=JSON.stringify(result);for(const key of ['userId','email','phone','telegramId','googleSub','session','reviewerId','verification','payment','objectKey'])assert.ok(!json.includes('"'+key+'"'));
 assert.equal(f.row._count.media,1);assert.equal(f.calls(),0);
});
test('preview HTTP enforces authentication, strict inputs, safe field errors and private cache headers',async()=>{
 const f=await fixture();const app=createApp(parseConfig({}),f.service,undefined,undefined,undefined,f.providerService,f.listingService);
 await withServer(app,async base=>{
  const url=base+'/api/v1/listings/'+f.row.id,token=(await f.service.createSessionForVerifiedUser(f.user.id)).token;
  const headers={authorization:'Bearer '+token,'content-type':'application/json','if-match':etag(f.row)};
  let r=await fetch(url+'/preview',{method:'POST'});assert.equal(r.status,401);await r.arrayBuffer();
  for(const body of [{status:'PREVIEW'},{providerId:f.ownerProvider.id},{price:'1'},[],null]){
   r=await fetch(url+'/preview',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,400);await r.arrayBuffer();
  }
  for(const status of ['DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW','PUBLISHED']){
   r=await fetch(url,{method:'PATCH',headers,body:JSON.stringify({status})});assert.equal(r.status,400);await r.arrayBuffer();
  }
  r=await fetch(url+'/preview',{method:'POST',headers:{authorization:headers.authorization}});assert.equal(r.status,428);await r.arrayBuffer();
  r=await fetch(url+'/preview',{method:'POST',headers:{...headers,'if-match':'*'}});assert.equal(r.status,400);await r.arrayBuffer();
  f.row.titleAm=null;r=await fetch(url+'/preview',{method:'POST',headers});assert.equal(r.status,422);
  assert.deepEqual(await r.json(),{error:{code:'LISTING_INCOMPLETE',message:'Listing information is incomplete or invalid',fields:['titleAm']}});
  f.row.titleAm=aiOutput.titleAm;r=await fetch(url+'/preview',{method:'POST',headers});assert.equal(r.status,200);
  const data=await r.json() as {listing:{etag:string;status:string}};assert.equal(data.listing.status,'PREVIEW');assert.equal(r.headers.get('etag'),data.listing.etag);assert.equal(r.headers.get('cache-control'),'no-store');
 });assert.equal(f.calls(),0);
});
