import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {HttpError} from '../errors.js';
import type {PaymentWebhookRepository} from './webhook-repository.js';
import type {PaymentVerificationService} from './verification-service.js';
const signature=z.string().regex(/^[a-fA-F0-9]{64}$/);
const envelope=z.object({event:z.string().min(1).max(128)});
const charge=z.object({tx_ref:z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)});
const events=new Set(['charge.success','charge.failed','charge.cancelled','charge.failed/cancelled','charge.pending']);
export type WebhookSignatures={chapa:unknown;payload:unknown};
export class PaymentWebhookService {
 constructor(private readonly repository:PaymentWebhookRepository,private readonly verification:PaymentVerificationService,private readonly secret?:string){}
 private authenticate(body:unknown,headers:WebhookSignatures){
  if(!this.secret)throw new HttpError('SERVICE_UNAVAILABLE');
  // Standard Chapa webhooks: static secret HMAC and/or JSON payload HMAC.
  // Compare only validated fixed-size digests, never log either digest or payload.
  const matches=(value:unknown,message:string)=>{
   const parsed=signature.safeParse(value);
   return parsed.success&&timingSafeEqual(Buffer.from(parsed.data,'hex'),createHmac('sha256',this.secret!).update(message).digest());
  };
  let serialized:string;
  try{serialized=JSON.stringify(body)??'';}catch{throw new HttpError('BAD_REQUEST');}
  if(!matches(headers.chapa,this.secret)&&!matches(headers.payload,serialized))throw new HttpError('WEBHOOK_UNAUTHORIZED');
 }
 async receive(body:unknown,headers:WebhookSignatures):Promise<void>{
  this.authenticate(body,headers);
  const parsed=envelope.safeParse(body);
  if(!parsed.success)throw new HttpError('BAD_REQUEST');
  // Refund/payout/subscription events are outside this foundation.
  if(!events.has(parsed.data.event))return;
  const input=charge.safeParse(body);
  if(!input.success)throw new HttpError('BAD_REQUEST');
  const payment=await this.repository.findByReference(input.data.tx_ref);
  if(!payment)return; // Same acknowledgement for unknown/legacy references; no identity disclosure.
  await this.verification.reconcileWebhook(payment);
 }
}
