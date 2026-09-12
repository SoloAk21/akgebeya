import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Prisma} from '../src/generated/prisma/client.js';
import {ProviderRole} from '../src/generated/prisma/enums.js';
import {HttpError,ListingIncompleteError} from '../src/errors.js';
import {etag} from '../src/listings/service.js';
import {aiFixture,aiOutput} from './ai-fixture.js';
import {createApp} from '../src/app.js';
import {parseConfig} from '../src/config.js';
import {withServer} from './helpers.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
const expected={amountMinor:'50000',currency:'ETB',pricingVersion:'v1'};
async function fixture(){let calls=0;const f=await aiFixture({async generate(){calls++;throw new Error('Unexpected Gemini');}});Object.assign(f.row,aiOutput,{status:'PREVIEW'});return {...f,calls:()=>calls};}
test('fee is exactly integer 50000 ETB minor units for every role, purpose and supported property type',async()=>{
 const groups={RESIDENTIAL:['STUDIO','APARTMENT','CONDOMINIUM','VILLA','HOUSE','G_PLUS_1','G_PLUS_2'],COMMERCIAL:['OFFICE','SHOP','WAREHOUSE','BUILDING','HOTEL'],LAND:['INDUSTRIAL_LAND','AGRICULTURAL_LAND','RESIDENTIAL_LAND','COMMERCIAL_LAND']} as const;
 for(const role of Object.values(ProviderRole))for(const type of ['SALE','RENT','BUY_REQUEST','RENT_REQUEST'] as const)for(const[category,types]of Object.entries(groups))for(const propertyType of types){
  const f=await fixture();f.records.get(f.ownerProvider.id)!.role=role;Object.assign(f.row,{category,type,propertyType});
  const source=etag(f.row),before={...f.row};const result=await f.listingService.calculateFee(f.context,f.row.id,source);
  assert.deepEqual(result.fee,expected);assert.equal(result.status,'CALCULATE_FEE');assert.notEqual(result.etag,source);
  const quote=f.quotes.get(f.row.id)!;assert.equal(quote.amountMinor,50000n);assert.equal(typeof quote.amountMinor,'bigint');assert.equal(quote.sourceRevision,source);
  const {status:_s,updatedAt:_u,revision:_r,...facts}=f.row;const {status:_a,updatedAt:_b,revision:_c,...old}=before;assert.deepEqual(facts,old);
  assert.equal(f.calls(),0);assert.equal(f.quotes.size,1);
 }
});
test('fee authorizes provider ownership, current verification and active state and rejects deleted/wrong lifecycle listings',async()=>{
 const f=await fixture(),s=f.listingService,id=f.row.id,p=f.records.get(f.ownerProvider.id)!;
 await assert.rejects(()=>s.calculateFee(f.otherContext,id,etag(f.row)),denied('LISTING_NOT_FOUND'));
 await assert.rejects(()=>s.calculateFee(f.adminContext,id,etag(f.row)),denied('FORBIDDEN'));
 for(const patch of [{review:null},{review:{...p.review!,status:'REJECTED' as const}},{status:'SUSPENDED' as const},{role:null}]){const old={...p};Object.assign(p,patch);await assert.rejects(()=>s.calculateFee(f.context,id,etag(f.row)),denied('FORBIDDEN'));Object.assign(p,old);}
 f.row.deletedAt=new Date();await assert.rejects(()=>s.calculateFee(f.context,id,etag(f.row)),denied('LISTING_NOT_FOUND'));f.row.deletedAt=null;
 for(const status of ['DRAFT','COMPLETE','VALIDATE','AI_ASSIST','CALCULATE_FEE','PUBLISHED','PAUSED','ARCHIVED'] as const){f.row.status=status;await assert.rejects(()=>s.calculateFee(f.context,id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));}
 assert.equal(f.quotes.size,0);assert.equal(f.calls(),0);
});
test('invalid stored listing data creates no quote and leaves PREVIEW unchanged',async()=>{
 const f=await fixture();
 for(const patch of [...['category','type','propertyType','titleEn','titleAm','descriptionEn','descriptionAm','price','locationId'].map(k=>({[k]:null})),{category:'LAND'},{location:null},{location:{...f.row.location,countryCode:'US'}},{price:new Prisma.Decimal('0')},{price:new Prisma.Decimal('NaN')},{currency:'USD'},{bedrooms:-1},{areaSqm:new Prisma.Decimal('0')},{publishedAt:new Date()}]){
  const old={...f.row};Object.assign(f.row,patch);const before=JSON.stringify(f.row);
  await assert.rejects(()=>f.listingService.calculateFee(f.context,f.row.id,etag(f.row)),e=>e instanceof ListingIncompleteError);
  assert.equal(JSON.stringify(f.row),before);assert.equal(f.quotes.size,0);Object.assign(f.row,old);
 }
});
test('fee ETags and concurrency yield one quote, preserve source revision, and never reprice or reset timestamps',async()=>{
 const f=await fixture(),s=f.listingService,id=f.row.id;
 await assert.rejects(()=>s.calculateFee(f.context,id,undefined),denied('PRECONDITION_REQUIRED'));
 for(const match of ['*','bad','W/'+etag(f.row)])await assert.rejects(()=>s.calculateFee(f.context,id,match),denied('BAD_REQUEST'));
 await assert.rejects(()=>s.calculateFee(f.context,id,'"'+'0'.repeat(64)+'"'),denied('PRECONDITION_FAILED'));
 const source=etag(f.row);const outcomes=await Promise.allSettled([s.calculateFee(f.context,id,source),s.calculateFee(f.context,id,source)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.ok(outcomes.some(r=>r.status==='rejected'&&denied('PRECONDITION_FAILED')(r.reason)));
 const quote={...f.quotes.get(id)!};assert.equal(quote.sourceRevision,source);
 await assert.rejects(()=>s.calculateFee(f.context,id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));
 assert.deepEqual(f.quotes.get(id),quote);assert.equal(f.quotes.size,1);assert.deepEqual(f.row._count,{payments:0,media:0});assert.equal(f.row.publishedAt,null);
 const read=await s.get(f.context,id);assert.ok('fee' in read);assert.deepEqual(read.fee,expected);
 await assert.rejects(()=>s.get(f.otherContext,id),denied('LISTING_NOT_FOUND'));assert.equal(f.calls(),0);
});
test('fee HTTP rejects all client pricing inputs, requires authentication/ETag and returns safe string money',async()=>{
 const f=await fixture();await withServer(createApp(parseConfig({}),f.service,undefined,undefined,undefined,f.providerService,f.listingService),async base=>{
  const url=base+'/api/v1/listings/'+f.row.id,token=(await f.service.createSessionForVerifiedUser(f.user.id)).token;
  const headers={authorization:'Bearer '+token,'content-type':'application/json','if-match':etag(f.row)};
  let r=await fetch(url+'/calculate-fee',{method:'POST'});assert.equal(r.status,401);await r.arrayBuffer();
  for(const body of [{amountMinor:1},{amount:'1'},{currency:'USD'},{pricingVersion:'hacked'},{providerId:f.ownerProvider.id},{pricingInputSnapshot:{}},{discount:1},{status:'CALCULATE_FEE'},[],null]){
   r=await fetch(url+'/calculate-fee',{method:'POST',headers,body:JSON.stringify(body)});assert.equal(r.status,400);await r.arrayBuffer();assert.equal(f.quotes.size,0);
  }
  r=await fetch(url+'/calculate-fee?amountMinor=1',{method:'POST',headers});assert.equal(r.status,400);await r.arrayBuffer();
  r=await fetch(url+'/calculate-fee',{method:'POST',headers:{authorization:headers.authorization}});assert.equal(r.status,428);await r.arrayBuffer();
  r=await fetch(url,{method:'PATCH',headers,body:'{"status":"CALCULATE_FEE"}'});assert.equal(r.status,400);await r.arrayBuffer();
  r=await fetch(url+'/calculate-fee',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);const body=await r.json() as {listingId:string;status:string;fee:unknown;etag:string};
  assert.deepEqual(body,{listingId:f.row.id,status:'CALCULATE_FEE',fee:expected,etag:etag(f.row)});assert.equal(r.headers.get('etag'),body.etag);assert.equal(r.headers.get('cache-control'),'no-store');
 });assert.equal(f.calls(),0);
});

test('fee does not derive money from floating-point listing prices and performs no external HTTP calls',async()=>{
 const originalFetch=globalThis.fetch;let networkCalls=0;
 globalThis.fetch=async()=>{networkCalls++;throw new Error('Unexpected external request');};
 try{
  for(const price of ['0.01','999.99','9007199254740993.99']){
   const f=await fixture();f.row.price=new Prisma.Decimal(price);
   const result=await f.listingService.calculateFee(f.context,f.row.id,etag(f.row));
   assert.deepEqual(result.fee,expected);assert.equal(f.row.price.toFixed(2),price);assert.equal(f.calls(),0);
  }
 }finally{globalThis.fetch=originalFetch;}
 assert.equal(networkCalls,0);
});
