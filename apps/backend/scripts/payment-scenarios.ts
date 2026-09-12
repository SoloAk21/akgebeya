import type {CompletionScenario} from './completion-scenarios.js';
import {previewScenarios} from './preview-scenarios.js';
export const paymentScenarios:CompletionScenario[]=previewScenarios.map(s=>({...s,
 name:s.name.replaceAll('AI_ASSIST','CALCULATE_FEE').replaceAll('preview','payment initiation').replaceAll('Preview','Initialize payment'),
 path:s.path.replace('/preview','/payment'),
 ...(s.listingStatus?{listingStatus:s.listingStatus==='AI_ASSIST'?'CALCULATE_FEE':s.listingStatus==='PREVIEW'?'PAYMENT':s.listingStatus}:{}),
}));
paymentScenarios.splice(14,0,...[{amountMinor:1},{currency:'USD'},{tx_ref:'injected'},{idempotencyKey:'injected'},{feeQuoteId:'injected'},{userId:'injected'},{listingId:'injected'},{pricingVersion:'injected'},{callbackUrl:'https://example.com'},{returnUrl:'https://example.com'}].map(body=>({name:'Reject supplied '+Object.keys(body)[0],actor:'owner' as const,method:'POST',path:'/{{id}}/payment',match:'{{revision}}',body,status:400,error:'BAD_REQUEST'})));
paymentScenarios.push({name:'Reject direct PATCH PAYMENT',actor:'owner',method:'PATCH',path:'/{{id}}',match:'{{revision}}',body:{status:'PAYMENT'},status:400,error:'BAD_REQUEST'});
