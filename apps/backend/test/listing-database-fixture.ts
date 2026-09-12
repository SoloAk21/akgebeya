import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { withProviderDatabaseFixture } from './provider-database-fixture.js';
import type { AuthConfig } from '../src/config.js';
import { ListingService } from '../src/listings/service.js';
import { PrismaListingRepository } from '../src/listings/repository.js';
import type { AuthContext } from '../src/auth/types.js';
type Actor={id:string;token:string;context:AuthContext};
type Fixture=Parameters<Parameters<typeof withProviderDatabaseFixture>[0]>[0];
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function withListingDatabaseFixture(run:(f:Fixture & {
 listings:ListingService;actors:Record<'owner'|'other'|'admin'|'spare'|'rejected'|'suspended'|'roleless',Actor>;
 nonDraftId:string;locations:Set<string>;providerIds:string[];
})=>Promise<void>,config?:AuthConfig){
 await withProviderDatabaseFixture(async f=>{
  const {db,service,auth}=f;const extraIds:string[]=[];const locations=new Set<string>();const providerIds:string[]=[];
  const actors={...f.actors} as Record<'owner'|'other'|'admin'|'spare'|'rejected'|'suspended'|'roleless',Actor>;
  try{
   for(const name of ['rejected','suspended','roleless'] as const){
    const user=await db.user.create({data:{email:randomUUID()+'@example.com',displayName:'Draft fixture'}});
    extraIds.push(user.id);const issued=await auth.createSessionForVerifiedUser(user.id);
    actors[name]={id:user.id,token:issued.token,context:await auth.authenticate(issued.token)};
   }
   for(const name of ['owner','other','spare','rejected','suspended','roleless'] as const){
    const p=name==='roleless'?await db.provider.create({data:{userId:actors[name].id,nameEn:'Legacy role fixture'}})
     :await service.create(actors[name].context,{role:'OWNER',nameEn:'Listing fixture provider'});
    providerIds.push(p.id);
    if(['owner','other','rejected','suspended'].includes(name)){
     const v=await service.submit(actors[name].context);
     await service.decide(actors.admin.context,p.id,{verificationId:v.id},name!=='rejected');
    }
    if(name==='suspended')await db.provider.update({where:{id:p.id},data:{status:'SUSPENDED'}});
   }
   const location=await db.location.create({data:{regionEn:'Test region',cityEn:'Test city'}});locations.add(location.id);
   const nonDraft=await db.listing.create({data:{providerId:providerIds[0]!,status:'PAUSED',category:'RESIDENTIAL',type:'SALE',
    propertyType:'HOUSE',titleEn:'Non-draft fixture',descriptionEn:'Private lifecycle rejection fixture',price:'100',locationId:location.id}});
   const before=digest(await db.provider.findMany({where:{id:{in:providerIds}},orderBy:{id:'asc'}}));
   await run({...f,actors,locations,providerIds,nonDraftId:nonDraft.id,listings:new ListingService(new PrismaListingRepository(db))});
   assert.ok(before===digest(await db.provider.findMany({where:{id:{in:providerIds}},orderBy:{id:'asc'}})),'Provider data changed');
  }finally{
   try{
    const rows=await db.listing.findMany({where:{providerId:{in:providerIds}},select:{id:true,locationId:true}});
    for(const row of rows)if(row.locationId)locations.add(row.locationId);
    const listingIds=rows.map(r=>r.id);
    await db.media.deleteMany({where:{listingId:{in:listingIds}}});
    await db.$transaction([
     db.payment.deleteMany({where:{listingId:{in:listingIds}}}),
     db.listingFeeQuote.deleteMany({where:{listingId:{in:listingIds}}}),
     db.listing.deleteMany({where:{id:{in:listingIds}}}),
    ]);
    assert.equal(await db.listingFeeQuote.count({where:{listingId:{in:listingIds}}}),0);
    await db.location.deleteMany({where:{id:{in:[...locations]}}});
    await db.verification.deleteMany({where:{userId:{in:extraIds}}});
    await db.provider.deleteMany({where:{userId:{in:extraIds}}});
    await db.user.deleteMany({where:{id:{in:extraIds}}});
    assert.equal(await db.listing.count({where:{providerId:{in:providerIds}}}),0);
    assert.equal(await db.location.count({where:{id:{in:[...locations]}}}),0);
   }catch{throw new Error('Draft fixture cleanup failed');}
  }
 },config);
}
