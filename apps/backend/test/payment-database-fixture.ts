import assert from 'node:assert/strict';
import {withListingDatabaseFixture} from './listing-database-fixture.js';
import {completeInput} from './completion-fixture.js';
import {aiOutput} from './ai-fixture.js';
import type {AuthConfig} from '../src/config.js';
import {PrismaListingRepository} from '../src/listings/repository.js';
import {ListingService} from '../src/listings/service.js';
import type {ChapaClient} from '../src/payments/client.js';
type Fixture=Parameters<Parameters<typeof withListingDatabaseFixture>[0]>[0];
export async function withPaymentDatabaseFixture(run:(f:Fixture&{paymentListingId:string;repository:PrismaListingRepository;paymentService:ListingService;createQuoted:()=>Promise<string>})=>Promise<void>,client:ChapaClient,config?:AuthConfig){
 await withListingDatabaseFixture(async f=>{
  const existingPayments=await f.db.payment.findMany({orderBy:{id:'asc'}}),existingMedia=await f.db.media.findMany({orderBy:{id:'asc'}});
  const repository=new PrismaListingRepository(f.db);
  const paymentService=new ListingService(repository,{async generate(){throw new Error('Gemini is forbidden');}},client);
  const createQuoted=async()=>{
   const draft=await f.listings.create(f.actors.owner.context,{...completeInput(),...aiOutput});
   await f.db.listing.update({where:{id:draft.id},data:{status:'PREVIEW'}});
   await f.listings.calculateFee(f.actors.owner.context,draft.id,(await f.listings.get(f.actors.owner.context,draft.id)).etag);return draft.id;
  };
  const paymentListingId=await createQuoted();
  await run({...f,paymentListingId,repository,paymentService,createQuoted});
  assert.deepEqual(await f.db.payment.findMany({where:{id:{in:existingPayments.map(p=>p.id)}},orderBy:{id:'asc'}}),existingPayments);
  assert.deepEqual(await f.db.media.findMany({orderBy:{id:'asc'}}),existingMedia);
 },config);
}
