import { Prisma,type PrismaClient } from '../generated/prisma/client.js';
import { findProviderRecord } from '../providers/repository.js';
import { retryTransaction,isLockFailure } from '../auth/transaction-retry.js';
import { HttpError } from '../errors.js';
import type { DraftInput } from './input.js';
import type { DraftRecord,DraftStore,ListingRepository,ListingRow } from './types.js';
const include={location:true,_count:{select:{payments:true,media:true}}} as const;
export class PrismaListingRepository implements ListingRepository {
 constructor(private readonly db:PrismaClient){}
 async recordPaymentFailure(id:string,outcome:'REJECTED'|'UNKNOWN'){
  await this.db.payment.updateMany({where:{id,initializationStatus:'RESERVED'},data:{initializationStatus:outcome,status:outcome==='REJECTED'?'FAILED':'PENDING'}});
 }
 withProvider<T>(userId:string,run:(store:DraftStore)=>Promise<T>):Promise<T>{
  return retryTransaction(()=>this.db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
   await tx.$queryRaw`SELECT id FROM akgebeya.providers WHERE "userId"=${userId}::uuid FOR UPDATE`;
   const provider=await findProviderRecord(tx,{userId});
   const providerId=provider?.id;
   async function revisions(rows:ListingRow[]):Promise<DraftRecord[]>{
    if(!rows.length)return [];
    const stamps=await tx.$queryRaw<{id:string;revision:string}[]>`SELECT id,
     to_char("updatedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS revision
     FROM akgebeya.listings WHERE id IN (${Prisma.join(rows.map(r=>Prisma.sql`${r.id}::uuid`))})`;
    return rows.map(row=>({...row,revision:stamps.find(s=>s.id===row.id)!.revision}));
   }
   async function get(id:string,lock=false){
    if(!providerId)return null;
    if(lock)await tx.$queryRaw`SELECT id FROM akgebeya.listings WHERE id=${id}::uuid AND "providerId"=${providerId}::uuid FOR UPDATE`;
    let row=await tx.listing.findFirst({where:{id,providerId,deletedAt:null},include});
    if(lock&&row?.locationId){
     await tx.$queryRaw`SELECT id FROM akgebeya.locations WHERE id=${row.locationId}::uuid FOR SHARE`;
     row={...row,location:await tx.location.findUnique({where:{id:row.locationId}})};
    }
    return row?(await revisions([row]))[0]!:null;
   }
   async function data(input:DraftInput){
    const {location,price,areaSqm,...rest}=input;
    let locationId:string|null|undefined;
    // Never accept a client-selected shared location ID or mutate an existing location.
    if(location!==undefined)locationId=location===null?null:(await tx.location.create({data:location})).id;
    return {...rest,...(locationId===undefined?{}:{locationId}),
     ...(price===undefined?{}:{price:price===null?null:new Prisma.Decimal(price)}),
     ...(areaSqm===undefined?{}:{areaSqm:areaSqm===null?null:new Prisma.Decimal(areaSqm)})};
   }
   async function advance(current:DraftRecord){
     await tx.$executeRaw`UPDATE akgebeya.listings SET "updatedAt"=GREATEST(clock_timestamp(),${current.revision}::timestamptz+interval '1 microsecond') WHERE id=${current.id}::uuid`;
   }
   return run({provider,
    findPayment:async listingId=>{
     await tx.$queryRaw`SELECT id FROM akgebeya.payments WHERE "listingId"=${listingId}::uuid FOR UPDATE`;
     return tx.payment.findFirst({where:{listingId},orderBy:{createdAt:'asc'}});
    },
    settlePayment:async(id,status,notification)=>{
     const changed=await tx.$executeRaw`UPDATE akgebeya.payments SET status=${status}::akgebeya."PaymentStatus", "paidAt"=CASE WHEN ${status}='SUCCEEDED' THEN GREATEST(clock_timestamp(),"createdAt") ELSE NULL END,"updatedAt"=clock_timestamp() WHERE id=${id}::uuid AND status<>'SUCCEEDED' AND status::text<>${status}`;
     const payment=await tx.payment.findUniqueOrThrow({where:{id}});
     if(changed===1)await tx.notification.create({data:{userId:payment.userId,type:'PAYMENT',...notification}});
     return payment;
    },
    publish:async current=>{
     const changed=await tx.$executeRaw`UPDATE akgebeya.listings SET status='PUBLISHED',"publishedAt"=clock_timestamp() WHERE id=${current.id}::uuid AND "providerId"=${providerId}::uuid AND status::text='VERIFY_PAYMENT' AND "publishedAt" IS NULL AND "deletedAt" IS NULL`;
     if(changed!==1)throw new HttpError('LISTING_TRANSITION_CONFLICT');
     await advance(current);
     return (await revisions([await tx.listing.findUniqueOrThrow({where:{id:current.id},include})]))[0]!;
    },
    reservePayment:async input=>tx.payment.create({data:{...input,gateway:'CHAPA',status:'PENDING',initializationStatus:'RESERVED'}}),
    initializePayment:async(id,checkoutUrl)=>{
     const changed=await tx.payment.updateMany({where:{id,initializationStatus:'RESERVED',status:'PENDING'},data:{initializationStatus:'INITIALIZED',checkoutUrl}});
     if(changed.count!==1)throw new HttpError('LISTING_TRANSITION_CONFLICT');
    },
    create:async input=>{
     if(!providerId)throw new HttpError('FORBIDDEN');
     const row=await tx.listing.create({data:{...await data(input),providerId,status:'DRAFT'},include});
     return (await revisions([row]))[0]!;
    },get,
    mine:async(limit,offset)=>providerId?revisions(await tx.listing.findMany({
     where:{providerId,status:'DRAFT',deletedAt:null},include,orderBy:[{createdAt:'desc'},{id:'desc'}],take:limit,skip:offset,
    })):[],
    transition:async(current,target)=>{
     const changed=await tx.listing.updateMany({where:{id:current.id,providerId,status:current.status,deletedAt:null,publishedAt:null},data:{status:target}});
     if(changed.count!==1)throw new HttpError('LISTING_TRANSITION_CONFLICT');
     await advance(current);
     const row=await tx.listing.findUniqueOrThrow({where:{id:current.id},include});
     return (await revisions([row]))[0]!;
    },
    findFeeQuote:async id=>providerId?tx.listingFeeQuote.findFirst({where:{listingId:id,listing:{providerId,deletedAt:null}}}):null,
    createFeeQuote:async(current,fee,sourceRevision)=>{
     if(!providerId||current.providerId!==providerId)throw new HttpError('FORBIDDEN');
     return tx.listingFeeQuote.create({data:{listingId:current.id,...fee,sourceRevision}});
    },
    saveAi:async(current,output)=>{
     const {titleEn,titleAm,descriptionEn,descriptionAm}=output;
     const changed=await tx.listing.updateMany({where:{id:current.id,providerId,status:'VALIDATE',deletedAt:null,publishedAt:null},
      data:{titleEn,titleAm,descriptionEn,descriptionAm,status:'AI_ASSIST'}});
     if(changed.count!==1)throw new HttpError('LISTING_TRANSITION_CONFLICT');
     await advance(current);
     const row=await tx.listing.findUniqueOrThrow({where:{id:current.id},include});
     return (await revisions([row]))[0]!;
    },
    update:async(current,input,remove)=>{
     const patch=remove?{deletedAt:new Date()}:await data(input);
     const result=await tx.listing.updateMany({where:{id:current.id,providerId,status:'DRAFT',deletedAt:null},data:patch});
     if(result.count!==1)throw new HttpError('LISTING_CONFLICT');
     await advance(current);
     const row=await tx.listing.findUniqueOrThrow({where:{id:current.id},include});
     return (await revisions([row]))[0]!;
    },
   });
  },{timeout:20_000,maxWait:10_000}),isLockFailure);
 }
}
