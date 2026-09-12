import assert from 'node:assert/strict';
import {test} from 'node:test';
import {withFeeDatabaseFixture} from '../fee-database-fixture.js';
import {ListingService} from '../../src/listings/service.js';
import {PrismaListingRepository} from '../../src/listings/repository.js';
import type {ListingRepository} from '../../src/listings/types.js';
import {HttpError} from '../../src/errors.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
test('Neon fee calculation atomically quotes one exact source revision, rolls back failures, and preserves facts/auth/payment data',async()=>{
 await withFeeDatabaseFixture(async({db,actors,previewId,sourceRevision})=>{
  let calls=0;const repository=new PrismaListingRepository(db);
  const s=new ListingService(repository,{async generate(){calls++;throw new Error('Unexpected Gemini');}});
  const owner=actors.owner.context;
  const before=await db.listing.findUniqueOrThrow({where:{id:previewId}});
  for(const name of ['admin','spare','rejected','suspended','roleless'] as const)await assert.rejects(()=>s.calculateFee(actors[name].context,previewId,sourceRevision),denied('FORBIDDEN'));
  await assert.rejects(()=>s.calculateFee(actors.other.context,previewId,sourceRevision),denied('LISTING_NOT_FOUND'));
  const location=await db.location.findUniqueOrThrow({where:{id:before.locationId!}});
  try{await db.location.update({where:{id:location.id},data:{countryCode:'US'}});
   await assert.rejects(()=>s.calculateFee(owner,previewId,sourceRevision),denied('LISTING_INCOMPLETE'));
   assert.equal(await db.listingFeeQuote.count({where:{listingId:previewId}}),0);
  }finally{await db.location.update({where:{id:location.id},data:{countryCode:location.countryCode,updatedAt:location.updatedAt}});}
  // Fail after quote and state writes but before transaction commit; exercise actual rollback.
  const failure=new Error('Controlled transaction failure');
  const failing:ListingRepository={withProvider(userId,run){return repository.withProvider(userId,async store=>{await run(store);throw failure;});}};
  await assert.rejects(()=>new ListingService(failing).calculateFee(owner,previewId,sourceRevision),e=>e===failure);
  assert.deepEqual(await db.listing.findUniqueOrThrow({where:{id:previewId}}),before);
  assert.equal(await db.listingFeeQuote.count({where:{listingId:previewId}}),0);
  const outcomes=await Promise.allSettled([s.calculateFee(owner,previewId,sourceRevision),s.calculateFee(owner,previewId,sourceRevision)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.ok(outcomes.some(r=>r.status==='rejected'&&denied('PRECONDITION_FAILED')(r.reason)));
  const quotes=await db.listingFeeQuote.findMany({where:{listingId:previewId}});assert.equal(quotes.length,1);const quote=quotes[0]!;
  assert.equal(quote.amountMinor,50000n);assert.equal(quote.currency,'ETB');assert.equal(quote.pricingVersion,'v1');assert.equal(quote.sourceRevision,sourceRevision);
  const current=await s.get(owner,previewId);assert.equal(current.status,'CALCULATE_FEE');assert.ok('fee' in current);assert.deepEqual(current.fee,{amountMinor:'50000',currency:'ETB',pricingVersion:'v1'});
  await assert.rejects(()=>s.calculateFee(owner,previewId,current.etag),denied('LISTING_TRANSITION_CONFLICT'));
  assert.deepEqual(await db.listingFeeQuote.findMany({where:{listingId:previewId}}),quotes);
  await assert.rejects(()=>s.get(actors.other.context,previewId),denied('LISTING_NOT_FOUND'));
  assert.equal(await db.payment.count({where:{listingId:previewId}}),0);assert.equal(calls,0);
 });
});
