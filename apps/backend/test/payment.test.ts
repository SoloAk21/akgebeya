import assert from 'node:assert/strict';
import {test} from 'node:test';
import {completionFixture} from './completion-fixture.js';
import {aiOutput} from './ai-fixture.js';
import {ListingService,etag} from '../src/listings/service.js';
import {HttpError} from '../src/errors.js';
import {ChapaFailure,minorToMajor,type ChapaClient} from '../src/payments/client.js';
import {HttpChapaClient} from '../src/payments/chapa-client.js';
import {parseChapaConfig,parseConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {withServer} from './helpers.js';
const checkoutUrl='https://checkout.chapa.co/checkout/payment/local-test';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
async function fixture(client?:ChapaClient){
 const f=await completionFixture();Object.assign(f.row,aiOutput,{status:'PREVIEW'});
 await f.listingService.calculateFee(f.context,f.row.id,etag(f.row));
 let calls=0;
 const s=new ListingService(f.repository,{async generate(){throw new Error('No Gemini');}},{async initialize(input){calls++;assert.deepEqual(Object.keys(input).sort(),['amountMinor','currency','txRef']);assert.equal(input.amountMinor,50000n);assert.equal(input.currency,'ETB');assert.match(input.txRef,/^akg-[a-f0-9-]{36}$/);return client?client.initialize(input):{checkoutUrl};}});
 return {...f,s,calls:()=>calls};
}
test('payment reserves authoritative quote, then initializes once; preserves listing facts and financial pending state',async()=>{
 const f=await fixture(),revision=etag(f.row),quote={...f.quotes.get(f.row.id)!};
 const before={...f.row};const result=await f.s.payment(f.context,f.row.id,revision);
 assert.equal(result.status,'PAYMENT');assert.deepEqual(result.payment,{status:'PENDING',amountMinor:'50000',currency:'ETB',checkoutUrl});
 assert.equal(f.calls(),1);assert.equal(f.payments.size,1);
 const p=[...f.payments.values()][0]!;assert.equal(p.feeQuoteId,quote.id);assert.equal(p.userId,f.context.user.id);assert.equal(p.listingId,f.row.id);assert.equal(p.sourceRevision,revision);
 assert.equal(p.status,'PENDING');assert.equal(p.initializationStatus,'INITIALIZED');assert.equal(p.paidAt,null);assert.equal(p.refundedAmountMinor,0n);assert.equal(p.gateway,'CHAPA');assert.notEqual(p.idempotencyKey,p.gatewayReference);
 assert.deepEqual(f.quotes.get(f.row.id),quote);
 for(const key of ['providerId','category','type','propertyType','price','locationId','titleEn','titleAm','descriptionEn','descriptionAm','publishedAt'] as const)assert.equal(f.row[key],before[key]);
 await assert.rejects(()=>f.s.payment(f.context,f.row.id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));assert.equal(f.calls(),1);
});
test('payment denies unauthorized providers, private ownership, deleted rows and every wrong lifecycle',async()=>{
 const f=await fixture();
 await assert.rejects(()=>f.s.payment(f.adminContext,f.row.id,etag(f.row)),denied('FORBIDDEN'));
 await assert.rejects(()=>f.s.payment(f.otherContext,f.row.id,etag(f.row)),denied('LISTING_NOT_FOUND'));
 const p=f.records.get(f.ownerProvider.id)!;
 for(const patch of [{review:null},{review:{...p.review!,status:'REJECTED' as const}},{status:'SUSPENDED' as const},{role:null}]){const old={...p};Object.assign(p,patch);await assert.rejects(()=>f.s.payment(f.context,f.row.id,etag(f.row)),denied('FORBIDDEN'));Object.assign(p,old);}
 f.row.deletedAt=new Date();await assert.rejects(()=>f.s.payment(f.context,f.row.id,etag(f.row)),denied('LISTING_NOT_FOUND'));f.row.deletedAt=null;
 for(const status of ['DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW','PAYMENT','PUBLISHED','PAUSED','ARCHIVED'] as const){f.row.status=status;await assert.rejects(()=>f.s.payment(f.context,f.row.id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));}
 assert.equal(f.calls(),0);assert.equal(f.payments.size,0);
});
test('payment requires exact ETag and immutable valid V1 quote and complete bilingual listing',async()=>{
 const f=await fixture(),id=f.row.id;
 for(const [match,code]of [[undefined,'PRECONDITION_REQUIRED'],['bad','BAD_REQUEST'],['"'+'0'.repeat(64)+'"','PRECONDITION_FAILED']] as const)await assert.rejects(()=>f.s.payment(f.context,id,match),denied(code));
 const quote=f.quotes.get(id)!;f.quotes.delete(id);await assert.rejects(()=>f.s.payment(f.context,id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));f.quotes.set(id,quote);
 for(const patch of [{amountMinor:1n},{currency:'USD'},{pricingVersion:'v2'},{sourceRevision:'bad'},{listingId:'wrong'}]){const old={...quote};Object.assign(quote,patch);await assert.rejects(()=>f.s.payment(f.context,id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));Object.assign(quote,old);}
 for(const patch of [{titleAm:null},{descriptionAm:null},{publishedAt:new Date()},{location:null},{price:null}]){const old={...f.row};Object.assign(f.row,patch);await assert.rejects(()=>f.s.payment(f.context,id,etag(f.row)),denied('LISTING_INCOMPLETE'));Object.assign(f.row,old);}
 assert.equal(f.calls(),0);assert.equal(f.payments.size,0);
});
test('rejected, unknown, malformed and interrupted outcomes block subsequent calls without mutation',async()=>{
 for(const mode of ['REJECTED','UNKNOWN','network','malformed'] as const){
  const f=await fixture({async initialize(){if(mode==='malformed')return {checkoutUrl:'http://untrusted.invalid/'};if(mode==='network')throw new Error('sensitive upstream message');throw new ChapaFailure(mode);}}),revision=etag(f.row);
  await assert.rejects(()=>f.s.payment(f.context,f.row.id,revision),denied(mode==='REJECTED'?'PAYMENT_INITIALIZATION_REJECTED':'PAYMENT_INITIALIZATION_UNKNOWN'));
  const p=[...f.payments.values()][0]!;assert.equal(p.initializationStatus,mode==='REJECTED'?'REJECTED':'UNKNOWN');assert.equal(p.status,mode==='REJECTED'?'FAILED':'PENDING');assert.equal(p.checkoutUrl,null);assert.equal(p.paidAt,null);assert.equal(f.row.status,'CALCULATE_FEE');assert.equal(etag(f.row),revision);
  await assert.rejects(()=>f.s.payment(f.context,f.row.id,revision),denied('LISTING_TRANSITION_CONFLICT'));assert.equal(f.calls(),1);
 }
});
test('concurrency reserves once; network runs outside transaction; revision changes prevent finalization',async()=>{
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);
 const f=await fixture({async initialize(){entered();await wait;return {checkoutUrl};}});const revision=etag(f.row);
 const first=f.s.payment(f.context,f.row.id,revision);await started;
 assert.equal([...f.payments.values()][0]!.initializationStatus,'RESERVED');assert.equal(f.row.status,'CALCULATE_FEE');
 // Completing another repository transaction here proves no transaction is held across the client call.
 await f.repository.withProvider(f.context.user.id,async()=>{});
 await assert.rejects(()=>f.s.payment(f.context,f.row.id,revision),denied('LISTING_TRANSITION_CONFLICT'));
 f.row.revision+='changed';release();await assert.rejects(()=>first,denied('PRECONDITION_FAILED'));
 assert.equal(f.row.status,'CALCULATE_FEE');assert.equal([...f.payments.values()][0]!.initializationStatus,'UNKNOWN');assert.equal(f.calls(),1);
 const g=await fixture();const outcomes=await Promise.allSettled([g.s.payment(g.context,g.row.id,etag(g.row)),g.s.payment(g.context,g.row.id,etag(g.row))]);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.equal(g.calls(),1);assert.equal(g.payments.size,1);
});
test('HTTP rejects all client overrides and unauthenticated access; exposes only safe payment response',async()=>{
 const f=await fixture();const app=createApp(parseConfig({}),f.service,undefined,undefined,undefined,f.providerService,f.s);
 await withServer(app,async base=>{
  const url=base+'/api/v1/listings/'+f.row.id+'/payment';assert.equal((await fetch(url,{method:'POST'})).status,401);
  const session=await f.service.createSessionForVerifiedUser(f.context.user.id);
  const headers={authorization:'Bearer '+session.token,'content-type':'application/json','if-match':etag(f.row)};
  for(const key of ['amount','amountMinor','currency','tx_ref','gatewayReference','idempotencyKey','userId','providerId','listingId','feeQuoteId','pricingVersion','callbackUrl','returnUrl','status']){
   const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({[key]:'tamper'})});assert.equal(r.status,400);assert.equal((await r.json() as {error:{code:string}}).error.code,'BAD_REQUEST');
  }
  const r=await fetch(url,{method:'POST',headers,body:'{}'});assert.equal(r.status,200);
  const body=await r.json() as Record<string,unknown>;assert.deepEqual(Object.keys(body).sort(),['etag','listingId','payment','status']);assert.deepEqual(Object.keys(body.payment as object).sort(),['amountMinor','checkoutUrl','currency','status']);
 });
});
test('integer conversion is exact, references unique across independent attempts',async()=>{
 assert.equal(minorToMajor(50000n),'500.00');assert.equal(minorToMajor(900719925474099399n),'9007199254740993.99');assert.throws(()=>minorToMajor(0n));assert.throws(()=>minorToMajor(-1n));
 const a=await fixture(),b=await fixture();await a.s.payment(a.context,a.row.id,etag(a.row));await b.s.payment(b.context,b.row.id,etag(b.row));const x=[...a.payments.values()][0]!,y=[...b.payments.values()][0]!;assert.notEqual(x.gatewayReference,y.gatewayReference);assert.notEqual(x.idempotencyKey,y.idempotencyKey);
});
test('Chapa HTTP client validates upstream URL/envelope, masks errors, and never retries',async()=>{
 const config={secretKey:'synthetic-local-test-key',baseUrl:'https://api.chapa.co/v1' as const,callbackUrl:'https://example.com/callback',returnUrl:'https://example.com/return',timeoutMs:100};
 const input={amountMinor:50000n,currency:'ETB' as const,txRef:'akg-local-test'};
 let calls=0;const client=new HttpChapaClient(config,async(url,options)=>{calls++;assert.equal(url,'https://api.chapa.co/v1/transaction/initialize');assert.equal(options?.redirect,'error');const payload=JSON.parse(String(options?.body));assert.equal(payload.amount,'500.00');assert.equal(payload.currency,'ETB');assert.equal(payload.tx_ref,input.txRef);assert.ok(!('email'in payload));return new Response(JSON.stringify({status:'success',data:{checkout_url:checkoutUrl}}));});
 assert.deepEqual(await client.initialize(input),{checkoutUrl});assert.equal(calls,1);
 for(const [status,body,outcome]of [[401,{status:'failed',message:'Authorization required'},'REJECTED'],[400,{status:'failed',message:'Transaction reference has been used before'},'UNKNOWN'],[429,{},'UNKNOWN'],[500,{},'UNKNOWN'],[200,{status:'success',data:{checkout_url:'https://evil.invalid/'}},'UNKNOWN'],[200,{status:'success',data:{checkout_url:'https://checkout.chapa.co.evil.invalid/checkout/test'}},'UNKNOWN'],[200,{status:'success',data:{}},'UNKNOWN']] as const){let count=0;const c=new HttpChapaClient(config,async()=>{count++;return new Response(JSON.stringify(body),{status});});await assert.rejects(()=>c.initialize(input),(e:unknown)=>e instanceof ChapaFailure&&e.outcome===outcome&&e.message==='Payment initialization failed');assert.equal(count,1);}
 for(const request of [async()=>{throw new Error('sensitive network detail');},async()=>new Response('not-json'),async()=>new Response('x'.repeat(17000))])await assert.rejects(()=>new HttpChapaClient(config,request).initialize(input),(e:unknown)=>e instanceof ChapaFailure&&e.outcome==='UNKNOWN'&&!e.message.includes('sensitive'));
 await assert.rejects(()=>new HttpChapaClient({...config,timeoutMs:1},async(_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(new Error('abort'))))).initialize(input),(e:unknown)=>e instanceof ChapaFailure&&e.outcome==='UNKNOWN');
 assert.throws(()=>parseChapaConfig({CHAPA_BASE_URL:'http://evil.invalid'}),/Invalid Chapa configuration/);
 assert.throws(()=>parseChapaConfig({CHAPA_CALLBACK_URL:'https://user:password@example.com'}),/Invalid Chapa configuration/);
});
