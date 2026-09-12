import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ProviderRole} from '../generated/prisma/enums.js';
import {verifiedProviderId} from '../providers/service.js';
import type {AuthContext} from '../auth/types.js';
import type {ListingRepository,DraftStore} from '../listings/types.js';
import {assertComplete} from '../listings/completion.js';
import {etag} from '../listings/service.js';
import {HttpError} from '../errors.js';
import {ChapaFailure,checkoutSchema,type ChapaClient} from './client.js';
export class PaymentInitiationService {
 constructor(private readonly repository:ListingRepository,private readonly client:ChapaClient){}
 async initiate(context:AuthContext,id:string,match:string|undefined){
  if(!z.string().uuid().safeParse(id).success)throw new HttpError('BAD_REQUEST');
  if(match===undefined)throw new HttpError('PRECONDITION_REQUIRED');
  if(!/^"[a-f0-9]{64}"$/.test(match))throw new HttpError('BAD_REQUEST');
  const check=async(store:DraftStore)=>{
   verifiedProviderId(context,store.provider,Object.values(ProviderRole));
   const row=await store.get(id,true);if(!row)throw new HttpError('LISTING_NOT_FOUND');
   if(etag(row)!==match)throw new HttpError('PRECONDITION_FAILED');
   if(row.status!=='CALCULATE_FEE')throw new HttpError('LISTING_TRANSITION_CONFLICT');
   assertComplete(row,true);
   const quote=await store.findFeeQuote(id);
   if(!quote||quote.listingId!==id||quote.amountMinor!==50000n||quote.currency!=='ETB'||quote.pricingVersion!=='v1'||!/^"[a-f0-9]{64}"$/.test(quote.sourceRevision))throw new HttpError('LISTING_TRANSITION_CONFLICT');
   return {row,quote};
  };
  const reservation=await this.repository.withProvider(context.user.id,async store=>{
   const {row,quote}=await check(store);
   if(await store.findPayment(id)||row._count.payments>0)throw new HttpError('LISTING_TRANSITION_CONFLICT');
   return store.reservePayment({userId:context.user.id,listingId:id,feeQuoteId:quote.id,amountMinor:quote.amountMinor,currency:quote.currency,
    gatewayReference:'akg-'+randomUUID(),idempotencyKey:randomUUID(),sourceRevision:etag(row)});
  });
  let checkoutUrl:string;
  try{const output=await this.client.initialize({amountMinor:reservation.amountMinor,currency:reservation.currency,txRef:reservation.gatewayReference!});
   const parsed=z.object({checkoutUrl:checkoutSchema}).strict().safeParse(output);if(!parsed.success)throw new ChapaFailure('UNKNOWN');checkoutUrl=parsed.data.checkoutUrl;
  }catch(e){
   const outcome=e instanceof ChapaFailure?e.outcome:'UNKNOWN';
   await this.repository.recordPaymentFailure(reservation.id,outcome).catch(()=>{});
   throw new HttpError(outcome==='REJECTED'?'PAYMENT_INITIALIZATION_REJECTED':'PAYMENT_INITIALIZATION_UNKNOWN');
  }
  try{return await this.repository.withProvider(context.user.id,async store=>{
   const {row,quote}=await check(store);const current=await store.findPayment(id);
   if(!current||current.id!==reservation.id||current.feeQuoteId!==quote.id||current.sourceRevision!==match||current.initializationStatus!=='RESERVED'||current.status!=='PENDING'
    ||current.amountMinor!==quote.amountMinor||current.currency!==quote.currency||current.userId!==context.user.id||current.gatewayReference!==reservation.gatewayReference||current.idempotencyKey!==reservation.idempotencyKey)throw new HttpError('LISTING_TRANSITION_CONFLICT');
   await store.initializePayment(current.id,checkoutUrl);const updated=await store.transition(row,'PAYMENT');
   return {listingId:id,status:updated.status,payment:{status:'PENDING' as const,amountMinor:current.amountMinor.toString(),currency:current.currency,checkoutUrl},etag:etag(updated)};
  });}catch(e){
   await this.repository.recordPaymentFailure(reservation.id,'UNKNOWN').catch(()=>{});
   if(e instanceof HttpError)throw e;
   throw new HttpError('PAYMENT_INITIALIZATION_UNKNOWN');
  }
 }
}
