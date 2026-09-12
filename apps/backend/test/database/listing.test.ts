import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withListingDatabaseFixture } from '../listing-database-fixture.js';
import { HttpError } from '../../src/errors.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
test('Neon drafts preserve ownership/NULLs; atomic ETags prevent lost updates; soft deletion and RBAC fail closed',async()=>{
 await withListingDatabaseFixture(async({db,listings:s,actors,nonDraftId,locations})=>{
  const row=await s.create(actors.owner.context,{});
  const stored=await db.listing.findUniqueOrThrow({where:{id:row.id}});
  const provider=await db.provider.findUniqueOrThrow({where:{userId:actors.owner.id}});
  assert.equal(stored.providerId,provider.id);assert.equal(stored.status,'DRAFT');
  for(const key of ['category','type','propertyType','titleEn','titleAm','descriptionEn','descriptionAm','locationId','price','publishedAt'] as const)assert.equal(stored[key],null);
  for(const name of ['admin','spare','rejected','suspended','roleless'] as const)await assert.rejects(()=>s.create(actors[name].context,{}),denied('FORBIDDEN'));
  await assert.rejects(()=>s.get(actors.other.context,row.id),denied('LISTING_NOT_FOUND'));
  await assert.rejects(()=>s.update(actors.other.context,row.id,{titleEn:'No'},row.etag),denied('LISTING_NOT_FOUND'));
  const results=await Promise.allSettled([
   s.update(actors.owner.context,row.id,{titleEn:'First edit'},row.etag),
   s.update(actors.owner.context,row.id,{titleEn:'Second edit'},row.etag),
  ]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(results.filter(r=>r.status==='rejected').every(r=>denied('PRECONDITION_FAILED')(r.reason)));
  const current=await s.get(actors.owner.context,row.id);assert.notEqual(current.etag,row.etag);
  const updated=await s.update(actors.owner.context,row.id,{titleAm:'\u1264\u1275',descriptionAm:'\u1218\u130d\u1208\u132b',category:'RESIDENTIAL',propertyType:'APARTMENT',
   type:'BUY_REQUEST',price:'1234.50',location:{regionEn:'Real fixture region',cityEn:'Real fixture city'}},current.etag);
  locations.add(updated.location!.id);assert.equal(updated.titleAm,'\u1264\u1275');assert.equal(updated.descriptionEn,null);
  assert.equal(updated.price,'1234.50');assert.equal(updated.status,'DRAFT');
  await assert.rejects(()=>s.update(actors.owner.context,row.id,{category:'LAND'},updated.etag),denied('BAD_REQUEST'));
  await assert.rejects(()=>s.update(actors.owner.context,nonDraftId,{titleEn:'No'},updated.etag),denied('LISTING_CONFLICT'));
  assert.equal(await db.payment.count({where:{listingId:row.id}}),0);
  assert.equal(await db.media.count({where:{listingId:row.id}}),0);
  await s.update(actors.owner.context,row.id,{},updated.etag,true);
  const deleted=await db.listing.findUniqueOrThrow({where:{id:row.id}});
  assert.equal(deleted.status,'DRAFT');assert.ok(deleted.deletedAt);assert.equal(deleted.publishedAt,null);
  await assert.rejects(()=>s.get(actors.owner.context,row.id),denied('LISTING_NOT_FOUND'));
  await assert.rejects(()=>s.update(actors.owner.context,row.id,{titleEn:'No'},updated.etag),denied('LISTING_NOT_FOUND'));
  assert.equal((await s.mine(actors.owner.context,{})).listings.length,0);
 });
});
