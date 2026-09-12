import assert from 'node:assert/strict';
import {test} from 'node:test';
import {completionFixture} from './completion-fixture.js';
import {aiOutput} from './ai-fixture.js';
import {ListingService,etag} from '../src/listings/service.js';
import {PaymentVerificationService} from '../src/payments/verification-service.js';
import {HttpChapaClient} from '../src/payments/chapa-client.js';
import {majorToMinor,ChapaVerificationFailure,type VerifiedTransaction} from '../src/payments/verification-client.js';
import {HttpError} from '../src/errors.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
const checkoutUrl='https://checkout.chapa.co/checkout/payment/test-verification';
async function fixture(){
 const f=await completionFixture();Object.assign(f.row,aiOutput,{status:'PREVIEW'});
 await f.listingService.calculateFee(f.context,f.row.id,etag(f.row));
 let calls=0;
 const s=new ListingService(f.repository,undefined,{async initialize(){return {checkoutUrl};}});
 await s.payment(f.context,f.row.id,etag(f.row));
 const payment=[...f.payments.values()][0]!;
 let output:VerifiedTransaction={status:'success',txRef:payment.gatewayReference!,amountMinor:50000n,currency:'ETB'};
 const service=new PaymentVerificationService(f.repository,{async verify(ref){calls++;assert.equal(ref,payment.gatewayReference);await f.repository.withProvider(f.context.user.id,async()=>{});return output;}});
 return {...f,payment,service,calls:()=>calls,set:(p:Partial<VerifiedTransaction>)=>{output={...output,...p};}};
}
test('verified success is idempotent, preserves binding and facts; publication requires current ETag and happens once',async()=>{
 const f=await fixture(),before={...f.row},quote={...f.quotes.get(f.row.id)!};
 const out=await f.service.verify(f.context,f.row.id);assert.equal(out.status,'VERIFY_PAYMENT');assert.equal(out.payment.status,'SUCCEEDED');assert.ok(out.payment.paidAt);assert.equal(f.row.publishedAt,null);
 const paidAt=f.payment.paidAt;assert.deepEqual(await f.service.verify(f.context,f.row.id),out);assert.equal(f.calls(),1);
 await assert.rejects(()=>f.service.publish(f.context,f.row.id,undefined),denied('PRECONDITION_REQUIRED'));
 await assert.rejects(()=>f.service.publish(f.context,f.row.id,'bad'),denied('BAD_REQUEST'));
 await assert.rejects(()=>f.service.publish(f.context,f.row.id,'"'+'0'.repeat(64)+'"'),denied('PRECONDITION_FAILED'));
 const rev=etag(f.row),attempts=await Promise.allSettled([f.service.publish(f.context,f.row.id,rev),f.service.publish(f.context,f.row.id,rev)]);
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.row.status,'PUBLISHED');assert.ok(f.row.publishedAt);
 await assert.rejects(()=>f.service.publish(f.context,f.row.id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));
 assert.equal((await f.service.verify(f.context,f.row.id)).status,'PUBLISHED');assert.equal(f.payment.paidAt,paidAt);assert.equal(f.calls(),1);assert.equal(f.payments.size,1);
 assert.deepEqual(f.quotes.get(f.row.id),quote);
 for(const k of ['providerId','category','type','propertyType','price','locationId','titleEn','titleAm','descriptionEn','descriptionAm'] as const)assert.equal(f.row[k],before[k]);
});
test('pending, failed, mismatched and unavailable results never establish success; failed can later reconcile authoritative success',async()=>{
 for(const status of ['pending','failed'] as const){const f=await fixture();f.set({status});const r=await f.service.verify(f.context,f.row.id);assert.equal(r.status,'PAYMENT');assert.equal(f.payment.status,status==='failed'?'FAILED':'PENDING');assert.equal(f.payment.paidAt,null);await assert.rejects(()=>f.service.publish(f.context,f.row.id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));f.set({status:'success'});assert.equal((await f.service.verify(f.context,f.row.id)).status,'VERIFY_PAYMENT');}
 for(const patch of [{amountMinor:1n},{currency:'USD'},{txRef:'different-reference'}]){const f=await fixture();f.set(patch);await assert.rejects(()=>f.service.verify(f.context,f.row.id),denied('PAYMENT_VERIFICATION_MISMATCH'));assert.equal(f.payment.status,'PENDING');assert.equal(f.row.status,'PAYMENT');assert.equal(f.row.publishedAt,null);}
 const f=await fixture();const unavailable=new PaymentVerificationService(f.repository,{async verify(){throw new Error('sensitive-raw-response');}});
 await assert.rejects(()=>unavailable.verify(f.context,f.row.id),e=>denied('PAYMENT_VERIFICATION_UNAVAILABLE')(e)&&!String(e).includes('sensitive'));assert.equal(f.payment.status,'PENDING');
});
test('RESERVED and UNKNOWN reconciliation reuses exact attempt without inventing checkout history',async()=>{
 for(const state of ['RESERVED','UNKNOWN'] as const){const f=await fixture();Object.assign(f.payment,{initializationStatus:state,checkoutUrl:null});f.row.status='CALCULATE_FEE';const id=f.payment.id;await f.service.verify(f.context,f.row.id);assert.equal(f.payment.id,id);assert.equal(f.payment.initializationStatus,state);assert.equal(f.payment.checkoutUrl,null);assert.equal(f.payment.status,'SUCCEEDED');assert.equal(f.payments.size,1);}
});
test('verification/publication deny invalid providers, ownership, deleted listings and invalid publication content',async()=>{
 const f=await fixture();
 for(const ctx of [f.adminContext,f.otherContext])await assert.rejects(()=>f.service.verify(ctx,f.row.id),denied(ctx===f.adminContext?'FORBIDDEN':'LISTING_NOT_FOUND'));
 const provider=f.records.get(f.ownerProvider.id)!;
 for(const patch of [{review:null},{review:{...provider.review!,status:'REJECTED'}},{status:'SUSPENDED'},{role:null}]){const old={...provider};Object.assign(provider,patch);await assert.rejects(()=>f.service.verify(f.context,f.row.id),denied('FORBIDDEN'));Object.assign(provider,old);}
 f.row.deletedAt=new Date();await assert.rejects(()=>f.service.verify(f.context,f.row.id),denied('LISTING_NOT_FOUND'));f.row.deletedAt=null;
 for(const state of ['DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW','PAUSED','ARCHIVED'] as const){f.row.status=state;await assert.rejects(()=>f.service.verify(f.context,f.row.id),denied('LISTING_TRANSITION_CONFLICT'));}f.row.status='PAYMENT';
 await f.service.verify(f.context,f.row.id);
 for(const patch of [{titleAm:null},{descriptionAm:null},{titleEn:null},{descriptionEn:null},{location:null},{price:null}]){const old={...f.row};Object.assign(f.row,patch);await assert.rejects(()=>f.service.publish(f.context,f.row.id,etag(f.row)),denied('LISTING_INCOMPLETE'));Object.assign(f.row,old);}
 provider.status='SUSPENDED';await assert.rejects(()=>f.service.publish(f.context,f.row.id,etag(f.row)),denied('FORBIDDEN'));assert.equal(f.row.status,'VERIFY_PAYMENT');assert.equal(f.row.publishedAt,null);
});
test('concurrent verification cannot downgrade success; changed revision rejects stale network result',async()=>{
 const f=await fixture();let release!:()=>void,entered!:()=>void;
 const wait=new Promise<void>(r=>release=r),start=new Promise<void>(r=>entered=r);
 const slow=new PaymentVerificationService(f.repository,{async verify(){entered();await wait;return {status:'failed',txRef:f.payment.gatewayReference!,amountMinor:50000n,currency:'ETB'};}});
 const first=slow.verify(f.context,f.row.id);await start;await f.service.verify(f.context,f.row.id);release();assert.equal((await first).payment.status,'SUCCEEDED');
 const g=await fixture();const changed=new PaymentVerificationService(g.repository,{async verify(){g.row.revision='changed';return {status:'success',txRef:g.payment.gatewayReference!,amountMinor:50000n,currency:'ETB'};}});
 await assert.rejects(()=>changed.verify(g.context,g.row.id),denied('PRECONDITION_FAILED'));assert.equal(g.payment.status,'PENDING');
});
test('Chapa verification checks transaction status, bounds response, sanitizes errors and converts money without floating point',async()=>{
 assert.equal(majorToMinor('500.00'),50000n);assert.equal(majorToMinor(500),50000n);
 for(const v of ['NaN','1e3','-500','500.001','',NaN,Infinity,500.5])assert.throws(()=>majorToMinor(v),ChapaVerificationFailure);
 const config={secretKey:'private-fixture-secret',baseUrl:'https://api.chapa.co/v1' as const,callbackUrl:undefined,returnUrl:undefined,timeoutMs:20};
 for(const status of ['success','pending','failed'] as const){let calls=0;const client=new HttpChapaClient(config,async(url,options)=>{calls++;assert.equal(String(url),config.baseUrl+'/transaction/verify/test-ref');assert.equal(options?.method,'GET');return Response.json({status:'success',data:{mode:'live',status,tx_ref:'test-ref',amount:'500.00',currency:'ETB',email:'private-unused-identity'}});});assert.equal((await client.verify('test-ref')).status,status);assert.equal(calls,1);}
 for(const response of [()=>new Response('sensitive-raw', {status:500}),()=>Response.json({status:'success',data:{}}),()=>Response.json({status:'success',data:{status:'success',tx_ref:'r',currency:'ETB',amount:'500.000'}}),()=>new Response('x'.repeat(17000))]){
  const client=new HttpChapaClient(config,async()=>response());await assert.rejects(()=>client.verify('r'),e=>e instanceof ChapaVerificationFailure&&!String(e).includes('private')&&!String(e).includes('sensitive'));
 }
 const timeout=new HttpChapaClient(config,async(_u,o)=>new Promise((_r,reject)=>o?.signal?.addEventListener('abort',()=>reject(new Error('secret-header')))));
 await assert.rejects(()=>timeout.verify('r'),ChapaVerificationFailure);
});

test('verification refuses altered quote/payment bindings and malformed gateway proof',async()=>{
 const f=await fixture(),q=f.quotes.get(f.row.id)!;
 for(const patch of [{amountMinor:1n},{currency:'USD'},{pricingVersion:'other'},{sourceRevision:'invalid'},{listingId:'different'}]){const old={...q};Object.assign(q,patch);await assert.rejects(()=>f.service.verify(f.context,f.row.id),denied('LISTING_TRANSITION_CONFLICT'));Object.assign(q,old);}
 for(const patch of [{userId:'different'},{feeQuoteId:null},{gatewayReference:null},{sourceRevision:'invalid'},{amountMinor:1n},{refundedAmountMinor:1n}]){const old={...f.payment};Object.assign(f.payment,patch);await assert.rejects(()=>f.service.verify(f.context,f.row.id),denied('LISTING_TRANSITION_CONFLICT'));Object.assign(f.payment,old);}
 for(const value of [{},{status:'success',txRef:f.payment.gatewayReference,amountMinor:'50000',currency:'ETB'},{status:'success',txRef:f.payment.gatewayReference,amountMinor:50000n,currency:'ETB',extra:'private'}]){
  const service=new PaymentVerificationService(f.repository,{async verify(){return value as unknown as VerifiedTransaction;}});
  await assert.rejects(()=>service.verify(f.context,f.row.id),denied('PAYMENT_VERIFICATION_UNAVAILABLE'));
 }
 assert.equal(f.calls(),0);assert.equal(f.payment.status,'PENDING');assert.equal(f.row.publishedAt,null);
});
