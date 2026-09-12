import {Router} from 'express';
import type {PaymentWebhookService} from './webhook-service.js';
export function paymentWebhookRouter(service:PaymentWebhookService){
 const router=Router();
 router.post('/payments/webhooks/chapa',async(request,response)=>{
  // Reject duplicate signature headers instead of trusting a proxy-dependent joined value.
  const one=(name:string)=>{
   const values=request.headersDistinct[name];
   return values?.length===1?values[0]:undefined;
  };
  await service.receive(request.body,{chapa:one('chapa-signature'),payload:one('x-chapa-signature')});
  response.status(200).json({status:'ok'});
 });
 return router;
}
