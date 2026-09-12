import {paymentNotification} from './notifications.js';
import type {WebhookPaymentBinding} from './webhook-repository.js';
import {z} from 'zod';
import type {AuthContext} from '../auth/types.js';
import type {DraftStore,ListingRepository,DraftRecord} from '../listings/types.js';
import type {Payment} from '../generated/prisma/client.js';
import {ProviderRole} from '../generated/prisma/enums.js';
import {verifiedProviderId} from '../providers/service.js';
import {assertComplete} from '../listings/completion.js';
import {etag} from '../listings/service.js';
import {HttpError} from '../errors.js';
import {verifiedTransaction,type ChapaVerificationClient} from './verification-client.js';
const conflict=()=>new HttpError('LISTING_TRANSITION_CONFLICT');
function result(row:DraftRecord,payment:Payment){
 return {listingId:row.id,status:row.status,payment:{status:payment.status,amountMinor:payment.amountMinor.toString(),currency:payment.currency,paidAt:payment.paidAt},publishedAt:row.publishedAt,etag:etag(row)};
}
export class PaymentVerificationService {
 constructor(private readonly repository:ListingRepository,private readonly client?:ChapaVerificationClient){}
 private async bound(store:DraftStore,userId:string,id:string,context?:AuthContext){
  if(context)verifiedProviderId(context,store.provider,Object.values(ProviderRole));
  if(!store.provider||store.provider.userId!==userId)throw conflict();
  const row=await store.get(id,true);if(!row)throw new HttpError('LISTING_NOT_FOUND');
  const quote=await store.findFeeQuote(id),payment=await store.findPayment(id);
  if(!quote||!payment||row._count.payments!==1||quote.listingId!==id||payment.listingId!==id||payment.userId!==userId
   ||payment.feeQuoteId!==quote.id||quote.amountMinor!==50000n||quote.currency!=='ETB'||quote.pricingVersion!=='v1'
   ||payment.amountMinor!==quote.amountMinor||payment.currency!==quote.currency||payment.gateway!=='CHAPA'
   ||!payment.gatewayReference||!payment.idempotencyKey||!payment.initializationStatus||payment.refundedAmountMinor!==0n
   ||!/^"[a-f0-9]{64}"$/.test(payment.sourceRevision??'')||!/^"[a-f0-9]{64}"$/.test(quote.sourceRevision))throw conflict();
  if(!['CALCULATE_FEE','PAYMENT','VERIFY_PAYMENT','PUBLISHED'].includes(row.status))throw conflict();
  if(payment.status==='SUCCEEDED'){
   if(!payment.paidAt||!['VERIFY_PAYMENT','PUBLISHED'].includes(row.status))throw conflict();
  }else if(!['CALCULATE_FEE','PAYMENT'].includes(row.status)||payment.paidAt!==null||row.publishedAt!==null)throw conflict();
  return {row,payment};
 }
 async verify(context:AuthContext,id:string){
  if(!z.string().uuid().safeParse(id).success)throw new HttpError('BAD_REQUEST');
  return this.reconcile(context.user.id,id,context);
 }
 // Called only with a binding resolved from the stored CHAPA transaction reference.
 async reconcileWebhook(binding:WebhookPaymentBinding){
  return this.reconcile(binding.userId,binding.listingId,undefined,binding);
 }
 private async reconcile(userId:string,id:string,context?:AuthContext,binding?:WebhookPaymentBinding){
  const bind=async(store:DraftStore)=>{
   const current=await this.bound(store,userId,id,context);
   if(binding&&(current.payment.id!==binding.id||current.payment.gatewayReference!==binding.gatewayReference))throw conflict();
   return current;
  };
  const before=await this.repository.withProvider(userId,bind);
  if(before.payment.status==='SUCCEEDED')return result(before.row,before.payment);
  if(!this.client)throw new HttpError('SERVICE_UNAVAILABLE');
  const sourceRevision=etag(before.row);
  let output:unknown;
  try{output=await this.client.verify(before.payment.gatewayReference!);}
  catch{throw new HttpError('PAYMENT_VERIFICATION_UNAVAILABLE');}
  const parsed=verifiedTransaction.safeParse(output);
  if(!parsed.success)throw new HttpError('PAYMENT_VERIFICATION_UNAVAILABLE');
  const verified=parsed.data;
  // No database transaction spans the gateway request. Binding is reloaded under locks.
  return this.repository.withProvider(userId,async store=>{
   const {row,payment}=await bind(store);
   if(payment.id!==before.payment.id)throw conflict();
   if(payment.status==='SUCCEEDED')return result(row,payment);
   if(etag(row)!==sourceRevision)throw new HttpError('PRECONDITION_FAILED');
   if(verified.txRef!==payment.gatewayReference||verified.amountMinor!==payment.amountMinor||verified.currency!==payment.currency)
    throw new HttpError('PAYMENT_VERIFICATION_MISMATCH');
   if(verified.status==='pending'||(verified.status==='failed'&&payment.status==='FAILED'))return result(row,payment);
   const outcome=verified.status==='success'?'SUCCEEDED':'FAILED';
   const settled=await store.settlePayment(payment.id,outcome,paymentNotification(outcome));
   const updated=verified.status==='success'?await store.transition(row,'VERIFY_PAYMENT'):row;
   return result(updated,settled);
  });
 }
 async publish(context:AuthContext,id:string,match:string|undefined){
  if(!z.string().uuid().safeParse(id).success)throw new HttpError('BAD_REQUEST');
  if(match===undefined)throw new HttpError('PRECONDITION_REQUIRED');
  if(!/^"[a-f0-9]{64}"$/.test(match))throw new HttpError('BAD_REQUEST');
  return this.repository.withProvider(context.user.id,async store=>{
   const {row,payment}=await this.bound(store,context.user.id,id,context);
   if(etag(row)!==match)throw new HttpError('PRECONDITION_FAILED');
   if(row.status!=='VERIFY_PAYMENT'||payment.status!=='SUCCEEDED'||!payment.paidAt)throw conflict();
   assertComplete(row,true);
   return result(await store.publish(row),payment);
  });
 }
}
