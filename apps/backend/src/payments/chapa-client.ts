import {majorToMinor,ChapaVerificationFailure,type ChapaVerificationClient} from './verification-client.js';
import {z} from 'zod';
import type {ChapaConfig} from '../config.js';
import {ChapaFailure,checkoutSchema,minorToMajor,type ChapaClient,type ChapaInput} from './client.js';
const verificationStatus=z.enum(['success','pending','failed','cancelled','failed/cancelled']).transform(value=>value==='cancelled'||value==='failed/cancelled'?'failed':value);
const envelope=z.object({status:z.literal('success'),data:z.object({checkout_url:checkoutSchema})});
// Only fixed documented rejections are classified as definitive. Duplicate references are unresolved.
const rejections=new Set(["Authorization required","Invalid API Key or User doesn’t exist","Invalid API Key or User doesn't exist","Invalid currency, currency is not supported","Payments through API is disabled, please contact us","User can’t receive payments"]);
export class HttpChapaClient implements ChapaClient,ChapaVerificationClient {
 constructor(private readonly config:ChapaConfig,private readonly request:typeof fetch=fetch){}
 async verify(txRef:string){
  const c=this.config;
  if(!c.secretKey||!c.baseUrl||!z.string().min(1).max(128).safeParse(txRef).success)throw new ChapaVerificationFailure();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),c.timeoutMs);
  try{
   const response=await this.request(c.baseUrl+'/transaction/verify/'+encodeURIComponent(txRef),{method:'GET',redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+c.secretKey}});
   if(!response.ok)throw new ChapaVerificationFailure();
   const reader=response.body?.getReader();if(!reader)throw new ChapaVerificationFailure();
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384)throw new ChapaVerificationFailure();chunks.push(part.value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   const parsed=z.object({status:verificationStatus,data:z.object({mode:z.enum(['test','live']),status:verificationStatus,tx_ref:z.string().min(1).max(128),amount:z.union([z.string(),z.number()]),currency:z.string().min(1).max(8)})}).safeParse(body);
   if(!parsed.success)throw new ChapaVerificationFailure();
   const data=parsed.data.data;
   const expectedMode=c.secretKey.startsWith('CHASECK_TEST-')?'test':'live';
   if(data.mode!==expectedMode)throw new ChapaVerificationFailure();
   if(parsed.data.status!=='success'&&parsed.data.status!==data.status)throw new ChapaVerificationFailure();
   return {status:data.status,txRef:data.tx_ref,amountMinor:majorToMinor(data.amount),currency:data.currency};
  }catch{throw new ChapaVerificationFailure();}finally{clearTimeout(timer);}
 }
 async initialize(input:ChapaInput):Promise<{checkoutUrl:string}>{
  const c=this.config;if(!c.secretKey||!c.baseUrl||!c.callbackUrl||!c.returnUrl)throw new ChapaFailure('REJECTED');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),c.timeoutMs);
  try{
   const response=await this.request(c.baseUrl+'/transaction/initialize',{method:'POST',redirect:'error',signal:controller.signal,
    headers:{'content-type':'application/json',authorization:'Bearer '+c.secretKey},
    body:JSON.stringify({amount:minorToMajor(input.amountMinor),currency:input.currency,tx_ref:input.txRef,callback_url:c.callbackUrl,return_url:c.returnUrl})});
   const reader=response.body?.getReader();if(!reader)throw new ChapaFailure('UNKNOWN');
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>16384)throw new ChapaFailure('UNKNOWN');chunks.push(chunk.value);}}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   const body:unknown=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(!response.ok){
    const failure=z.object({status:z.literal('failed'),message:z.string()}).safeParse(body);
    if([400,401,404].includes(response.status)&&failure.success&&rejections.has(failure.data.message))throw new ChapaFailure('REJECTED');
    throw new ChapaFailure('UNKNOWN');
   }
   const result=envelope.safeParse(body);if(!result.success)throw new ChapaFailure('UNKNOWN');
   return {checkoutUrl:result.data.data.checkout_url};
  }catch(e){if(e instanceof ChapaFailure)throw e;throw new ChapaFailure('UNKNOWN');}
  finally{clearTimeout(timer);}
 }
}
