import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../../src/database.js';
import { Prisma } from '../../src/generated/prisma/client.js';
const db=createDatabaseClient(); after(()=>db.$disconnect());
const groups = {
 RESIDENTIAL:['STUDIO','APARTMENT','CONDOMINIUM','VILLA','HOUSE','G_PLUS_1','G_PLUS_2'],
 COMMERCIAL:['OFFICE','SHOP','WAREHOUSE','BUILDING','HOTEL'],
 LAND:['INDUSTRIAL_LAND','AGRICULTURAL_LAND','RESIDENTIAL_LAND','COMMERCIAL_LAND'],
};
test('Neon listing taxonomy, nullable fields, checks, indexes and foreign keys match the migration',async()=>{
 const enums=await db.$queryRaw<{typname:string;enumlabel:string}[]>`SELECT t.typname,e.enumlabel FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname='akgebeya' AND t.typname IN ('PropertyCategory','PropertyType','ListingType')`;
 for(const [name,values]of Object.entries({PropertyCategory:Object.keys(groups),PropertyType:Object.values(groups).flat(),ListingType:['SALE','RENT','BUY_REQUEST','RENT_REQUEST']}))assert.deepEqual(enums.filter(e=>e.typname===name).map(e=>e.enumlabel).sort(),[...values].sort());
 const columns=await db.$queryRaw<{column_name:string;is_nullable:string}[]>`SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema='akgebeya' AND table_name='listings'`;
 for(const name of ['category','type','propertyType','titleEn','titleAm','descriptionEn','descriptionAm','locationId','price','bedrooms','bathrooms','areaSqm'])assert.equal(columns.find(c=>c.column_name===name)?.is_nullable,'YES');
 for(const name of ['id','providerId','status','currency','createdAt','updatedAt'])assert.equal(columns.find(c=>c.column_name===name)?.is_nullable,'NO');
 const indexes=await db.$queryRaw<{indexname:string}[]>`SELECT indexname FROM pg_indexes WHERE schemaname='akgebeya' AND tablename='listings'`;
 assert.deepEqual(indexes.map(i=>i.indexname).sort(),['listings_pkey','listings_providerId_status_createdAt_idx','listings_locationId_status_idx','listings_status_type_propertyType_price_idx','listings_status_publishedAt_idx'].sort());
 const checks=await db.$queryRaw<{conname:string}[]>`SELECT conname FROM pg_constraint WHERE conrelid='akgebeya.listings'::regclass AND contype='c' AND convalidated`;
 assert.deepEqual(checks.map(c=>c.conname).sort(),['listings_content_check','listings_price_check','listings_dimensions_check','listings_category_type_check','listings_non_draft_complete_check','listings_publication_check','listings_draft_publication_check'].sort());
 const fks=await db.$queryRaw<{conname:string}[]>`SELECT conname FROM pg_constraint WHERE conrelid='akgebeya.listings'::regclass AND contype='f' AND convalidated`;
 assert.deepEqual(fks.map(f=>f.conname).sort(),['listings_providerId_fkey','listings_locationId_fkey'].sort());
});
test('Neon accepts partial drafts and exact taxonomy; rejects incompatible, blank, invalid and premature data',async()=>{
 const rollback=new Error('ROLLBACK_LISTING_SCHEMA_FIXTURES');
 try {await db.$transaction(async tx=>{
  const user=await tx.user.create({data:{email:randomUUID()+'@example.com',displayName:'Listing schema fixture'}});
  const provider=await tx.provider.create({data:{userId:user.id,role:'OWNER',nameEn:'Schema fixture'}});
  const draft=await tx.listing.create({data:{providerId:provider.id}});
  assert.equal(draft.status,'DRAFT');
  for(const key of ['category','type','propertyType','titleEn','titleAm','descriptionEn','descriptionAm','locationId','price','publishedAt'] as const)assert.equal(draft[key],null);
  const write=(data:Prisma.ListingUpdateInput)=>tx.listing.update({where:{id:draft.id},data});
  async function reject(sql:Prisma.Sql){
   await tx.$executeRawUnsafe('SAVEPOINT invalid_listing');
   let denied=false;
   try{await tx.$executeRaw(sql);}catch(e){denied=e instanceof Prisma.PrismaClientKnownRequestError&&['23514','22P02','23503','22003'].includes(String(e.meta?.code));}
   finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_listing');await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_listing');}
   assert.ok(denied,'Expected a database constraint rejection');
  }
  await write({category:'RESIDENTIAL'}); await write({category:null,type:'BUY_REQUEST'});
  for(const type of ['SALE','RENT','BUY_REQUEST','RENT_REQUEST'] as const)await write({type});
  for(const [category,types]of Object.entries(groups))for(const propertyType of types){
   await tx.$executeRaw`UPDATE akgebeya.listings SET category=${category}::akgebeya."PropertyCategory","propertyType"=${propertyType}::akgebeya."PropertyType" WHERE id=${draft.id}::uuid`;
   for(const other of Object.keys(groups).filter(c=>c!==category))await reject(Prisma.sql`UPDATE akgebeya.listings SET category=${other}::akgebeya."PropertyCategory" WHERE id=${draft.id}::uuid`);
  }
  await reject(Prisma.sql`UPDATE akgebeya.listings SET category=NULL WHERE id=${draft.id}::uuid`);
  await write({propertyType:null,category:null});
  for(const invalid of ['LAND','COMMERCIAL','OTHER','UNKNOWN','G+1'])await reject(Prisma.sql`UPDATE akgebeya.listings SET "propertyType"=${invalid}::akgebeya."PropertyType" WHERE id=${draft.id}::uuid`);
  await reject(Prisma.sql`UPDATE akgebeya.listings SET type='INVALID'::akgebeya."ListingType" WHERE id=${draft.id}::uuid`);
  await reject(Prisma.sql`UPDATE akgebeya.listings SET category='INVALID'::akgebeya."PropertyCategory" WHERE id=${draft.id}::uuid`);
  for(const column of ['titleEn','titleAm','descriptionEn','descriptionAm']){
   await reject(Prisma.sql`UPDATE akgebeya.listings SET ${Prisma.raw('"'+column+'"')}=${' \t\n'} WHERE id=${draft.id}::uuid`);
  }
  for(const value of ['0','-1','NaN','Infinity'])for(const column of ['price','areaSqm'])await reject(Prisma.sql`UPDATE akgebeya.listings SET ${Prisma.raw('"'+column+'"')}=${value}::numeric WHERE id=${draft.id}::uuid`);
  for(const column of ['bedrooms','bathrooms'])await reject(Prisma.sql`UPDATE akgebeya.listings SET ${Prisma.raw('"'+column+'"')}=-1 WHERE id=${draft.id}::uuid`);
  for(const status of ['PUBLISHED','PAUSED','ARCHIVED'])await reject(Prisma.sql`UPDATE akgebeya.listings SET status=${status}::akgebeya."ListingStatus" WHERE id=${draft.id}::uuid`);
  await reject(Prisma.sql`UPDATE akgebeya.listings SET "publishedAt"=now() WHERE id=${draft.id}::uuid`);
  await reject(Prisma.sql`UPDATE akgebeya.listings SET "locationId"=${randomUUID()}::uuid WHERE id=${draft.id}::uuid`);
  // Exercise the exact migration guard without altering schema or leaving fixtures.
  await rejectGuard();
  async function rejectGuard(){
   await tx.$executeRawUnsafe('SAVEPOINT listing_guard');
   let blocked=false;try{await tx.$executeRawUnsafe("DO $$ BEGIN IF EXISTS (SELECT 1 FROM akgebeya.listings) THEN RAISE EXCEPTION 'LISTINGS_NOT_EMPTY'; END IF; END $$;");}catch(e){blocked=e instanceof Prisma.PrismaClientKnownRequestError&&String(e.meta?.code)==='P0001';}
   finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT listing_guard');await tx.$executeRawUnsafe('RELEASE SAVEPOINT listing_guard');}
   assert.ok(blocked);
  }
  throw rollback;
 },{timeout:180_000,maxWait:10_000});}catch(e){if(e!==rollback)throw e;}
});
