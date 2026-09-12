import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withPaymentDatabaseFixture} from '../payment-database-fixture.js';
import {ChapaFailure} from '../../src/payments/client.js';
import {ListingService} from '../../src/listings/service.js';
import {HttpError} from '../../src/errors.js';
import type {ListingRepository} from '../../src/listings/types.js';
import {previewFacts} from '../preview-database-fixture.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
const checkoutUrl='https://checkout.chapa.co/checkout/payment/neon-local-fixture';
test('Neon payment reservation concurrency, quote binding, unknown/rejected states, finalization rollback and preservation',async()=>{
 let mode:'success'|'REJECTED'|'UNKNOWN'='success',calls=0,networkCheck:()=>Promise<void>=async()=>{};
 await withPaymentDatabaseFixture(async f=>{
  const {db,actors,paymentListingId:id,paymentService:s,repository}=f,owner=actors.owner.context;
  const before=await db.listing.findUniqueOrThrow({where:{id}}),quote=await db.listingFeeQuote.findUniqueOrThrow({where:{listingId:id}}),revision=(await s.get(owner,id)).etag;
  networkCheck=async()=>{await repository.withProvider(owner.user.id,async()=>{});const p=await db.payment.findUniqueOrThrow({where:{feeQuoteId:quote.id}});assert.equal(p.initializationStatus,'RESERVED');assert.equal((await db.listing.findUniqueOrThrow({where:{id}})).status,'CALCULATE_FEE');};
  for(const name of ['admin','spare','rejected','suspended','roleless'] as const)await assert.rejects(()=>s.payment(actors[name].context,id,revision),denied('FORBIDDEN'));
  await assert.rejects(()=>s.payment(actors.other.context,id,revision),denied('LISTING_NOT_FOUND'));
  const result=await Promise.allSettled([s.payment(owner,id,revision),s.payment(owner,id,revision)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);
  const payments=await db.payment.findMany({where:{listingId:id}});assert.equal(payments.length,1);const p=payments[0]!;
  assert.equal(p.feeQuoteId,quote.id);assert.equal(p.sourceRevision,revision);assert.equal(p.amountMinor,50000n);assert.equal(p.currency,'ETB');assert.equal(p.userId,owner.user.id);assert.equal(p.initializationStatus,'INITIALIZED');assert.equal(p.status,'PENDING');assert.equal(p.paidAt,null);assert.equal(p.refundedAmountMinor,0n);assert.equal(p.checkoutUrl,checkoutUrl);
  const after=await db.listing.findUniqueOrThrow({where:{id}});assert.equal(after.status,'PAYMENT');assert.equal(after.publishedAt,null);assert.deepEqual(previewFacts(after),previewFacts(before));assert.deepEqual(await db.listingFeeQuote.findUniqueOrThrow({where:{id:quote.id}}),quote);
  await assert.rejects(async()=>s.payment(owner,id,(await s.get(owner,id)).etag),denied('LISTING_TRANSITION_CONFLICT'));
  networkCheck=async()=>{};
  for(const outcome of ['REJECTED','UNKNOWN'] as const){mode=outcome;const failedId=await f.createQuoted(),rev=(await s.get(owner,failedId)).etag;const prior=await db.listing.findUniqueOrThrow({where:{id:failedId}});
   await assert.rejects(()=>s.payment(owner,failedId,rev),denied(outcome==='REJECTED'?'PAYMENT_INITIALIZATION_REJECTED':'PAYMENT_INITIALIZATION_UNKNOWN'));
   const failed=await db.payment.findFirstOrThrow({where:{listingId:failedId}});assert.equal(failed.initializationStatus,outcome);assert.equal(failed.status,outcome==='REJECTED'?'FAILED':'PENDING');assert.equal(failed.checkoutUrl,null);assert.deepEqual(await db.listing.findUniqueOrThrow({where:{id:failedId}}),prior);
   const count:number=calls;await assert.rejects(()=>s.payment(owner,failedId,rev),denied('LISTING_TRANSITION_CONFLICT'));assert.equal(calls,count);
  }
  mode='success';const rollbackId=await f.createQuoted(),rollbackRevision=(await s.get(owner,rollbackId)).etag;let phases=0;
  const broken:ListingRepository={recordPaymentFailure:repository.recordPaymentFailure.bind(repository),withProvider(userId,run){return repository.withProvider(userId,async store=>{const output=await run(store);if(++phases===2)throw new Error('Controlled finalization rollback');return output;});}};
  const brokenService=new ListingService(broken,undefined,{async initialize(){return {checkoutUrl};}});
  await assert.rejects(()=>brokenService.payment(owner,rollbackId,rollbackRevision),denied('PAYMENT_INITIALIZATION_UNKNOWN'));
  assert.equal((await db.listing.findUniqueOrThrow({where:{id:rollbackId}})).status,'CALCULATE_FEE');const unresolved=await db.payment.findFirstOrThrow({where:{listingId:rollbackId}});assert.equal(unresolved.initializationStatus,'UNKNOWN');assert.equal(unresolved.checkoutUrl,null);assert.equal(unresolved.status,'PENDING');
 },{async initialize(){calls++;await networkCheck();if(mode!=='success')throw new ChapaFailure(mode);return {checkoutUrl};}});
});
