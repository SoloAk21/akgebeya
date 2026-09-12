import assert from 'node:assert/strict';
import { test,after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../../src/database.js';
import { Prisma } from '../../src/generated/prisma/client.js';
const db=createDatabaseClient();after(()=>db.$disconnect());
test('Neon completion statuses preserve legacy values and enforce unpublished complete/validated listings',async()=>{
 const labels=await db.$queryRaw<{enumlabel:string}[]>`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='akgebeya' AND t.typname='ListingStatus'`;
 assert.deepEqual(labels.map(x=>x.enumlabel).sort(),['DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PUBLISHED','PAUSED','ARCHIVED'].sort());
 const rollback=new Error('ROLLBACK_COMPLETION_SCHEMA');
 try{await db.$transaction(async tx=>{
  const user=await tx.user.create({data:{email:randomUUID()+'@example.com',displayName:'Completion schema fixture'}});
  const provider=await tx.provider.create({data:{userId:user.id,role:'OWNER',nameEn:'Completion fixture'}});
  const location=await tx.location.create({data:{regionEn:'Test region',cityEn:'Test city'}});
  const row=await tx.listing.create({data:{providerId:provider.id,locationId:location.id,category:'LAND',type:'SALE',propertyType:'RESIDENTIAL_LAND',titleEn:'Test land',descriptionEn:'Schema fixture',price:'100'}});
  async function reject(data:Prisma.ListingUpdateInput){
   await tx.$executeRawUnsafe('SAVEPOINT invalid_completion');
   let rejected=false;try{await tx.listing.update({where:{id:row.id},data});}catch{rejected=true;}
   finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_completion');await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_completion');}
   assert.ok(rejected,'Expected database constraint rejection');
  }
  for(const status of ['DRAFT','COMPLETE','VALIDATE'] as const){
   await tx.listing.update({where:{id:row.id},data:{status,publishedAt:null}});
   await reject({publishedAt:new Date()});
   if(status!=='DRAFT')await reject({titleEn:null});
  }
  await reject({status:'PUBLISHED',publishedAt:null});
  await tx.listing.update({where:{id:row.id},data:{status:'PUBLISHED',publishedAt:new Date()}});
  await reject({deletedAt:new Date()});
  throw rollback;
 },{timeout:60000,maxWait:10000});}catch(e){if(e!==rollback)throw e;}
});
