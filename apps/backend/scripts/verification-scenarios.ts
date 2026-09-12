import type {CompletionScenario} from './completion-scenarios.js';
export const verificationScenarios:(CompletionScenario & {paymentStatus?:string})[]=[
 {name:'Read initialized listing',actor:'owner',method:'GET',path:'/{{id}}',status:200,listingStatus:'PAYMENT',capture:{revision:'etag',initialRevision:'etag'}},
 ...(['payment/verify','publish'] as const).flatMap(action=>[
  {name:'Unauthenticated '+action,method:'POST',path:'/{{id}}/'+action,status:401,error:'UNAUTHORIZED'},
  ...(['admin','spare','rejected','suspended','roleless','other'] as const).map(actor=>({name:actor+' denied '+action,actor,method:'POST',path:'/{{id}}/'+action,match:'{{revision}}',status:actor==='other'?404:403,error:actor==='other'?'LISTING_NOT_FOUND':'FORBIDDEN'})),
  ...[{amountMinor:1},{currency:'USD'},{tx_ref:'injected'},{status:'SUCCEEDED'},{userId:'injected'},{providerId:'injected'},{listingId:'injected'},{feeQuoteId:'injected'}].map(body=>({name:'Reject '+Object.keys(body)[0]+' on '+action,actor:'owner' as const,method:'POST',path:'/{{id}}/'+action,match:'{{revision}}',body,status:400,error:'BAD_REQUEST'})),
 ]),
 {name:'Unpaid publication denied',actor:'owner',method:'POST',path:'/{{id}}/publish',match:'{{revision}}',status:409,error:'LISTING_TRANSITION_CONFLICT'},
 {name:'Pending gateway payment',actor:'owner',method:'POST',path:'/{{id}}/payment/verify',status:200,listingStatus:'PAYMENT',paymentStatus:'PENDING'},
 {name:'Failed gateway payment',actor:'owner',method:'POST',path:'/{{id}}/payment/verify',status:200,listingStatus:'PAYMENT',paymentStatus:'FAILED'},
 {name:'Gateway amount mismatch',actor:'owner',method:'POST',path:'/{{id}}/payment/verify',status:502,error:'PAYMENT_VERIFICATION_MISMATCH'},
 {name:'Gateway network ambiguity',actor:'owner',method:'POST',path:'/{{id}}/payment/verify',status:502,error:'PAYMENT_VERIFICATION_UNAVAILABLE'},
 {name:'Verify authoritative payment',actor:'owner',method:'POST',path:'/{{id}}/payment/verify',status:200,listingStatus:'VERIFY_PAYMENT',capture:{revision:'etag'}},
 {name:'Duplicate verification',actor:'owner',method:'POST',path:'/{{id}}/payment/verify',status:200,listingStatus:'VERIFY_PAYMENT'},
 {name:'Publication missing If-Match',actor:'owner',method:'POST',path:'/{{id}}/publish',status:428,error:'PRECONDITION_REQUIRED'},
 {name:'Publication malformed If-Match',actor:'owner',method:'POST',path:'/{{id}}/publish',match:'invalid',status:400,error:'BAD_REQUEST'},
 {name:'Publication stale If-Match',actor:'owner',method:'POST',path:'/{{id}}/publish',match:'{{initialRevision}}',status:412,error:'PRECONDITION_FAILED'},
 {name:'Publish verified listing',actor:'owner',method:'POST',path:'/{{id}}/publish',match:'{{revision}}',status:200,listingStatus:'PUBLISHED',capture:{revision:'etag'}},
 {name:'Repeated publication',actor:'owner',method:'POST',path:'/{{id}}/publish',match:'{{revision}}',status:409,error:'LISTING_TRANSITION_CONFLICT'},
 {name:'Verify after publication',actor:'owner',method:'POST',path:'/{{id}}/payment/verify',status:200,listingStatus:'PUBLISHED'},
 {name:'Direct publication PATCH denied',actor:'owner',method:'PATCH',path:'/{{id}}',match:'{{revision}}',body:{status:'PUBLISHED'},status:400,error:'BAD_REQUEST'},
];
