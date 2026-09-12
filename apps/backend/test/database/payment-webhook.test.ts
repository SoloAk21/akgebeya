import {HttpError} from '../../src/errors.js';
import {createDatabaseClient} from '../../src/database.js';
import {etag} from '../../src/listings/service.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes,randomUUID,createHmac} from 'node:crypto';
import {withPaymentDatabaseFixture} from '../payment-database-fixture.js';
import {PaymentVerificationService} from '../../src/payments/verification-service.js';
import {PaymentWebhookService} from '../../src/payments/webhook-service.js';
import {PrismaPaymentWebhookRepository} from '../../src/payments/webhook-repository.js';
import {previewFacts} from '../preview-database-fixture.js';
import type {ListingRepository} from '../../src/listings/types.js';
import type {VerifiedTransaction} from '../../src/payments/verification-client.js';

test('Neon webhook/manual reconciliation: atomic notifications, rollback, duplicates, provider suspension and publication',async()=>{
 let notificationIds:string[]=[];
 await withPaymentDatabaseFixture(async f=>{
  const {db,repository,actors,paymentService:s,paymentListingId:id}=f,owner=actors.owner.context;
  const existing=await db.notification.findMany({orderBy:{id:'asc'}});
  const before=await db.listing.findUniqueOrThrow({where:{id}}),quote=await db.listingFeeQuote.findUniqueOrThrow({where:{listingId:id}});
  await s.payment(owner,id,(await s.get(owner,id)).etag);
  const p=await db.payment.findFirstOrThrow({where:{listingId:id}});
  let mode:'success'|'pending'|'failed'|'mismatch'|'network'='pending';
  const client={async verify(txRef:string):Promise<VerifiedTransaction>{await repository.withProvider(owner.user.id,async()=>{});if(mode==='network')throw new Error('Controlled failure');return {status:mode==='mismatch'?'success':mode,txRef,amountMinor:mode==='mismatch'?1n:50000n,currency:'ETB'};}};
  const verify=new PaymentVerificationService(repository,client),lookup=new PrismaPaymentWebhookRepository(db),secret=randomBytes(32).toString('base64url');
  const webhook=new PaymentWebhookService(lookup,verify,secret);
  const receive=(reference:string=p.gatewayReference!,event='charge.success')=>{const body={event,tx_ref:reference,amount:'1',currency:'USD',status:'success',userId:actors.other.id};return webhook.receive(body,{chapa:undefined,payload:createHmac('sha256',secret).update(JSON.stringify(body)).digest('hex')});};
  const notifications=()=>db.notification.findMany({where:{userId:owner.user.id,type:'PAYMENT'},orderBy:{createdAt:'asc'}});
  await receive('unknown-reference');assert.equal((await notifications()).length,0);
  await receive();assert.equal((await notifications()).length,0);
  await assert.rejects(async()=>verify.publish(owner,id,(await s.get(owner,id)).etag));
  mode='failed';await Promise.all([receive(),verify.verify(owner,id),receive()]);assert.equal((await notifications()).length,1);
  const failed=await db.payment.findUniqueOrThrow({where:{id:p.id}});assert.equal(failed.status,'FAILED');assert.equal(failed.paidAt,null);
  mode='pending';await receive();assert.equal((await notifications()).length,1);
  for(const value of ['mismatch','network'] as const){mode=value;await assert.rejects(()=>receive());assert.equal((await notifications()).length,1);assert.equal((await db.payment.findUniqueOrThrow({where:{id:p.id}})).status,'FAILED');}
  mode='success';let phase=0;
  const rollback:ListingRepository={recordPaymentFailure:repository.recordPaymentFailure.bind(repository),withProvider(userId,run){return repository.withProvider(userId,async store=>{const result=await run(store);if(++phase===2)throw new Error('Rollback after notification insert');return result;});}};
  const binding=await lookup.findByReference(p.gatewayReference!);assert.ok(binding);
  await assert.rejects(()=>new PaymentVerificationService(rollback,client).reconcileWebhook(binding));
  assert.equal((await notifications()).length,1);assert.equal((await db.payment.findUniqueOrThrow({where:{id:p.id}})).status,'FAILED');assert.equal((await db.listing.findUniqueOrThrow({where:{id}})).status,'PAYMENT');
  await Promise.all([receive(),verify.verify(owner,id),receive()]);assert.equal((await notifications()).length,2);
  const paid=await db.payment.findUniqueOrThrow({where:{id:p.id}});assert.equal(paid.status,'SUCCEEDED');assert.ok(paid.paidAt);
  mode='failed';await receive(p.gatewayReference!,'charge.failed');assert.deepEqual(await db.payment.findUniqueOrThrow({where:{id:p.id}}),paid);assert.equal((await notifications()).length,2);
  const ready=await db.listing.findUniqueOrThrow({where:{id}});assert.equal(ready.status,'VERIFY_PAYMENT');assert.equal(ready.publishedAt,null);assert.deepEqual(previewFacts(ready),previewFacts(before));
  await verify.publish(owner,id,(await s.get(owner,id)).etag);await receive();assert.equal((await notifications()).length,2);assert.equal((await db.listing.findUniqueOrThrow({where:{id}})).status,'PUBLISHED');
  assert.equal(await db.payment.count({where:{listingId:id}}),1);assert.deepEqual(await db.listingFeeQuote.findUniqueOrThrow({where:{id:quote.id}}),quote);
  for(const n of await notifications()){assert.match(n.titleAm??'',/\p{Script=Ethiopic}/u);assert.match(n.bodyAm??'',/\p{Script=Ethiopic}/u);assert.equal(n.readAt,null);assert.ok(!JSON.stringify(n).includes(p.gatewayReference!));assert.ok(!JSON.stringify(n).includes(p.idempotencyKey));}
  mode='success';
  for(const state of ['RESERVED','UNKNOWN'] as const){
   const next=await f.createQuoted(),q=await db.listingFeeQuote.findUniqueOrThrow({where:{listingId:next}});
   const reserved=await db.payment.create({data:{userId:owner.user.id,listingId:next,feeQuoteId:q.id,amountMinor:50000n,currency:'ETB',initializationStatus:state,sourceRevision:(await s.get(owner,next)).etag,gatewayReference:randomUUID(),idempotencyKey:randomUUID()}});
   await db.$executeRawUnsafe("UPDATE akgebeya.providers SET status='SUSPENDED' WHERE id=$1::uuid",before.providerId);
   try{await receive(reserved.gatewayReference!);await assert.rejects(async()=>verify.publish(owner,next,(await repository.withProvider(owner.user.id,async store=>etag((await store.get(next))!)))),error=>error instanceof HttpError&&error.code==='FORBIDDEN');}
   finally{await db.$executeRawUnsafe("UPDATE akgebeya.providers SET status='ACTIVE' WHERE id=$1::uuid",before.providerId);}
   const after=await db.payment.findUniqueOrThrow({where:{id:reserved.id}});assert.equal(after.status,'SUCCEEDED');assert.equal(after.initializationStatus,state);assert.equal(after.checkoutUrl,null);assert.equal(await db.payment.count({where:{listingId:next}}),1);
  }
  notificationIds=(await notifications()).map(n=>n.id);assert.equal(notificationIds.length,4);
  assert.deepEqual(await db.notification.findMany({where:{id:{in:existing.map(n=>n.id)}},orderBy:{id:'asc'}}),existing);
 },{async initialize(){return {checkoutUrl:'https://checkout.chapa.co/checkout/payment/local-webhook'};}});
 const cleaned=createDatabaseClient();try{assert.equal(await cleaned.notification.count({where:{id:{in:notificationIds}}}),0);}finally{await cleaned.$disconnect();}
});
