import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createDatabaseClient} from '../../src/database.js';
import {Prisma} from '../../src/generated/prisma/client.js';
const db=createDatabaseClient();after(()=>db.$disconnect());
test('Neon fixed fee quotes enforce exact V1 money, source format, immutability and atomic state consistency',async()=>{
 const rollback=new Error('ROLLBACK_FEE_SCHEMA');
 try{await db.$transaction(async tx=>{
  const user=await tx.user.create({data:{email:randomUUID()+'@example.com',displayName:'Fee schema fixture'}});
  const provider=await tx.provider.create({data:{userId:user.id,role:'OWNER',nameEn:'Fee fixture'}});
  const location=await tx.location.create({data:{regionEn:'Test region',cityEn:'Test city'}});
  const row=await tx.listing.create({data:{providerId:provider.id,locationId:location.id,status:'PREVIEW',category:'LAND',type:'SALE',propertyType:'RESIDENTIAL_LAND',titleEn:'Land',descriptionEn:'Test land',titleAm:'\u1218\u122c\u1275',descriptionAm:'\u1218\u122c\u1275',price:'100'}});
  const source='"'+'a'.repeat(64)+'"';
  const data={listingId:row.id,amountMinor:50000n,currency:'ETB' as const,pricingVersion:'v1',sourceRevision:source};
  async function reject(work:()=>Promise<unknown>){
   await tx.$executeRawUnsafe('SAVEPOINT invalid_fee');let denied=false;
   try{await work();await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');}
   catch(e){denied=(e instanceof Prisma.PrismaClientKnownRequestError&&['P2002','P2003','P2004'].includes(e.code))||(e instanceof Prisma.PrismaClientKnownRequestError&&['23514','23503','23505'].includes(String(e.meta?.code)))||(e instanceof Prisma.PrismaClientUnknownRequestError&&/23514/.test(e.message));}
   finally{await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_fee');await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_fee');}
   assert.ok(denied,'Expected fee constraint rejection');
  }
  await reject(()=>tx.listing.update({where:{id:row.id},data:{status:'CALCULATE_FEE'}}));
  await reject(()=>tx.listingFeeQuote.create({data}));
  for(const amountMinor of [0n,-1n,1n,49999n,50001n])await reject(()=>tx.listingFeeQuote.create({data:{...data,amountMinor}}));
  for(const pricingVersion of ['',' ','v2'])await reject(()=>tx.listingFeeQuote.create({data:{...data,pricingVersion}}));
  for(const sourceRevision of ['',' ','abc','a'.repeat(64),'"'+'A'.repeat(64)+'"'])await reject(()=>tx.listingFeeQuote.create({data:{...data,sourceRevision}}));
  await reject(()=>tx.listingFeeQuote.create({data:{...data,listingId:randomUUID()}}));
  await reject(()=>tx.listingFeeQuote.create({data:{...data,calculatedAt:new Date(0)}}));
  const quote=await tx.listingFeeQuote.create({data});
  await tx.listing.update({where:{id:row.id},data:{status:'CALCULATE_FEE'}});
  await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
  assert.equal(quote.amountMinor,50000n);assert.equal(quote.currency,'ETB');assert.equal(quote.pricingVersion,'v1');assert.equal(quote.sourceRevision,source);
  await reject(()=>tx.listingFeeQuote.create({data}));
  for(const patch of [{amountMinor:1n},{sourceRevision:'"'+'b'.repeat(64)+'"'},{calculatedAt:new Date()}])await reject(()=>tx.listingFeeQuote.update({where:{id:quote.id},data:patch}));
  await reject(()=>tx.listingFeeQuote.delete({where:{id:quote.id}}));
  await reject(()=>tx.listing.update({where:{id:row.id},data:{status:'PREVIEW'}}));
  for(const patch of [{publishedAt:new Date()},{titleAm:null},{descriptionAm:null},{titleEn:null},{descriptionEn:null},{category:null},{price:'0'}])await reject(()=>tx.listing.update({where:{id:row.id},data:patch}));
  throw rollback;
 },{timeout:180000,maxWait:10000});}catch(e){if(e!==rollback)throw e;}
});
