import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createDatabaseClient} from '../../src/database.js';
import {Prisma} from '../../src/generated/prisma/client.js';
const db=createDatabaseClient();after(()=>db.$disconnect());
test('Neon payment reservation binding, lifecycle, uniqueness and initialization constraints',async()=>{
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
  const quote=await tx.listingFeeQuote.create({data});
  await tx.listing.update({where:{id:row.id},data:{status:'CALCULATE_FEE'}});
  await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
  const paymentData={userId:user.id,listingId:row.id,feeQuoteId:quote.id,amountMinor:quote.amountMinor,currency:quote.currency,sourceRevision:source,gatewayReference:randomUUID(),idempotencyKey:randomUUID(),initializationStatus:'RESERVED' as const};
  for(const patch of [{userId:randomUUID()},{listingId:null},{sourceRevision:'bad'},{gatewayReference:null},{amountMinor:1n},{status:'SUCCEEDED' as const},{paidAt:new Date()},{refundedAmountMinor:1n},{initializationStatus:null}])await reject(()=>tx.payment.create({data:{...paymentData,...patch}}));
  const payment=await tx.payment.create({data:paymentData});
  await reject(()=>tx.payment.create({data:{...paymentData,idempotencyKey:randomUUID(),gatewayReference:randomUUID()}}));
  await reject(()=>tx.listing.update({where:{id:row.id},data:{status:'PAYMENT'}}));
  for(const patch of [{feeQuoteId:null},{listingId:null},{userId:randomUUID()},{amountMinor:1n},{gatewayReference:randomUUID()},{idempotencyKey:randomUUID()},{sourceRevision:'"'+'b'.repeat(64)+'"'}])await reject(()=>tx.payment.update({where:{id:payment.id},data:patch}));
  await reject(()=>tx.payment.update({where:{id:payment.id},data:{initializationStatus:'INITIALIZED'}}));
  await tx.payment.update({where:{id:payment.id},data:{initializationStatus:'INITIALIZED',checkoutUrl:'https://checkout.chapa.co/checkout/payment/test-fixture'}});
  await tx.listing.update({where:{id:row.id},data:{status:'PAYMENT'}});
  await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
  for(const patch of [{publishedAt:new Date()},{titleAm:null},{descriptionAm:null},{titleEn:null},{descriptionEn:null},{category:null},{price:'0'}])await reject(()=>tx.listing.update({where:{id:row.id},data:patch}));
  await reject(()=>tx.payment.delete({where:{id:payment.id}}));
  await reject(()=>tx.payment.update({where:{id:payment.id},data:{status:'SUCCEEDED'}}));
  throw rollback;
 },{timeout:180000,maxWait:10000});}catch(e){if(e!==rollback)throw e;}
});
