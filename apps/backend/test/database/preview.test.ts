import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withPreviewDatabaseFixture } from '../preview-database-fixture.js';
import { ListingService } from '../../src/listings/service.js';
import { PrismaListingRepository } from '../../src/listings/repository.js';
import { HttpError } from '../../src/errors.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
test('Neon preview locks/revalidates owned data, races safely, preserves facts and never calls Gemini',async()=>{
 await withPreviewDatabaseFixture(async({db,actors,previewId})=>{
  let calls=0;const s=new ListingService(new PrismaListingRepository(db),{async generate(){calls++;throw new Error('Unexpected AI call');}});
  const owner=actors.owner.context;const current=await s.get(owner,previewId);
  for(const name of ['admin','spare','rejected','suspended','roleless'] as const)
   await assert.rejects(()=>s.preview(actors[name].context,previewId,current.etag),denied('FORBIDDEN'));
  await assert.rejects(()=>s.preview(actors.other.context,previewId,current.etag),denied('LISTING_NOT_FOUND'));
  const row=await db.listing.findUniqueOrThrow({where:{id:previewId}});
  const location=await db.location.findUniqueOrThrow({where:{id:row.locationId!}});
  try{
   await db.location.update({where:{id:location.id},data:{countryCode:'US'}});
   await assert.rejects(()=>s.preview(owner,previewId,current.etag),denied('LISTING_INCOMPLETE'));
   assert.deepEqual(await db.listing.findUniqueOrThrow({where:{id:previewId}}),row);
  }finally{await db.location.update({where:{id:location.id},data:{countryCode:location.countryCode,updatedAt:location.updatedAt}});}
  const outcomes=await Promise.allSettled([s.preview(owner,previewId,current.etag),s.preview(owner,previewId,current.etag)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.ok(outcomes.some(x=>x.status==='rejected'&&denied('PRECONDITION_FAILED')(x.reason)));
  const result=await s.get(owner,previewId);assert.equal(result.status,'PREVIEW');assert.notEqual(result.etag,current.etag);
  await assert.rejects(()=>s.preview(owner,previewId,result.etag),denied('LISTING_TRANSITION_CONFLICT'));
  await assert.rejects(()=>s.get(actors.other.context,previewId),denied('LISTING_NOT_FOUND'));
  assert.equal(calls,0);
 });
});
