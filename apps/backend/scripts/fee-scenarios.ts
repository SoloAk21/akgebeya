import type {CompletionScenario} from './completion-scenarios.js';
import {previewScenarios} from './preview-scenarios.js';
// Reuse the existing private listing authorization/lifecycle/ETag request matrix.
export const feeScenarios:CompletionScenario[]=previewScenarios.map(s=>({
 ...s,name:s.name.replace('Repeated PREVIEW','Repeated calculation').replace('PATCH PREVIEW','PATCH CALCULATE_FEE').replaceAll('AI_ASSIST','PREVIEW').replaceAll('preview','fee calculation').replaceAll('Preview','Calculate fee'),
 path:s.path.replace('/preview','/calculate-fee'),
 ...(s.listingStatus?{listingStatus:s.listingStatus==='AI_ASSIST'?'PREVIEW':s.listingStatus==='PREVIEW'?'CALCULATE_FEE':s.listingStatus}:{}),
 ...(s.body&&typeof s.body==='object'&&'status' in s.body&&s.body.status==='PREVIEW'?{body:{status:'CALCULATE_FEE'}}:{}),
}));
feeScenarios.splice(14,0,...[{amountMinor:1},{currency:'USD'},{pricingVersion:'hacked'},{pricingInputSnapshot:{providerRole:'OWNER'}}].map(body=>({
 name:'Reject supplied '+Object.keys(body)[0],actor:'owner' as const,method:'POST',path:'/{{id}}/calculate-fee',match:'{{revision}}',body,status:400,error:'BAD_REQUEST',
})));
