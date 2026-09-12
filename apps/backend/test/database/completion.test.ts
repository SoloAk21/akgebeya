import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withListingDatabaseFixture } from '../listing-database-fixture.js';
import { completeInput } from '../completion-fixture.js';
import { HttpError } from '../../src/errors.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
test('Neon completion/validation preserve content and ownership, recheck locations, serialize transitions and leave no payment/media',async()=>{
 await withListingDatabaseFixture(async({db,listings:s,actors,locations})=>{
  const empty=await s.create(actors.owner.context,{});
  await assert.rejects(()=>s.transition(actors.owner.context,empty.id,'COMPLETE',empty.etag),denied('LISTING_INCOMPLETE'));
  assert.equal((await db.listing.findUniqueOrThrow({where:{id:empty.id}})).status,'DRAFT');
  for(const category of ['RESIDENTIAL','COMMERCIAL','LAND'] as const){
   const draft=await s.create(actors.owner.context,completeInput(category));locations.add(draft.location!.id);
   const original=await db.listing.findUniqueOrThrow({where:{id:draft.id}});
   const content=(row:typeof original)=>{const {status:_status,updatedAt:_updatedAt,...rest}=row;return JSON.stringify(rest);};
   await assert.rejects(()=>s.transition(actors.other.context,draft.id,'COMPLETE',draft.etag),denied('LISTING_NOT_FOUND'));
   for(const actor of ['admin','spare','rejected','suspended','roleless'] as const)
    await assert.rejects(()=>s.transition(actors[actor].context,draft.id,'COMPLETE',draft.etag),denied('FORBIDDEN'));
   await assert.rejects(()=>s.transition(actors.owner.context,draft.id,'VALIDATE',draft.etag),denied('LISTING_TRANSITION_CONFLICT'));
   for(const target of ['COMPLETE','VALIDATE'] as const){
    const current=await s.get(actors.owner.context,draft.id);
    if(target==='VALIDATE'){
     await db.location.update({where:{id:draft.location!.id},data:{countryCode:'US'}});
     await assert.rejects(()=>s.transition(actors.owner.context,draft.id,target,current.etag),denied('LISTING_INCOMPLETE'));
     assert.equal((await s.get(actors.owner.context,draft.id)).status,'COMPLETE');
     await db.location.update({where:{id:draft.location!.id},data:{countryCode:'ET'}});
    }
    const results=await Promise.allSettled([s.transition(actors.owner.context,draft.id,target,current.etag),s.transition(actors.owner.context,draft.id,target,current.etag)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.ok(results.filter(r=>r.status==='rejected').every(r=>denied('PRECONDITION_FAILED')(r.reason)));
    const actual=await db.listing.findUniqueOrThrow({where:{id:draft.id}});
    assert.equal(actual.status,target);assert.equal(content(actual),content(original));assert.equal(actual.publishedAt,null);
    await assert.rejects(async()=>s.transition(actors.owner.context,draft.id,target,(await s.get(actors.owner.context,draft.id)).etag),denied('LISTING_TRANSITION_CONFLICT'));
   }
   assert.equal(await db.payment.count({where:{listingId:draft.id}}),0);assert.equal(await db.media.count({where:{listingId:draft.id}}),0);
  }
 });
});
