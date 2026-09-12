import assert from 'node:assert/strict';
import {loadConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {withServer} from '../test/helpers.js';
import {withPaymentDatabaseFixture} from '../test/payment-database-fixture.js';
import {ListingService} from '../src/listings/service.js';
import {previewFacts} from '../test/preview-database-fixture.js';
import {privateListingCommand,runListingPostman} from './private-listing-command.js';
import {verificationScenarios} from './verification-scenarios.js';
let stage='configuration',status:number|undefined;
async function main(){
 const config=loadConfig();if(config.nodeEnv==='production')throw new Error('Development only');
 // Local deterministic transport only. This runner cannot contact a live payment gateway.
 for(const mode of ['curl','Postman'] as const){
  let calls=0;
  await withPaymentDatabaseFixture(async f=>{
   const {db,actors,paymentListingId:id,repository}=f,owner=actors.owner.context;
   await f.paymentService.payment(owner,id,(await f.paymentService.get(owner,id)).etag);
   const before=await db.listing.findUniqueOrThrow({where:{id}}),quote=await db.listingFeeQuote.findUniqueOrThrow({where:{listingId:id}}),payment=await db.payment.findFirstOrThrow({where:{listingId:id}});
   const s=new ListingService(repository,{async generate(){throw new Error('No Gemini');}},{async initialize(){throw new Error('No second payment');},async verify(ref){calls++;assert.equal(ref,payment.gatewayReference);if(calls===4)throw new Error('Controlled private failure');return {status:calls===1?'pending':calls===2?'failed':'success',txRef:ref,amountMinor:calls===3?1n:50000n,currency:'ETB'};}});
   await withServer(createApp(config,f.auth,undefined,undefined,undefined,f.service,s),async address=>{
    const base=address+'/api/v1/listings';
    if(mode==='Postman'){stage='Postman requests';await runListingPostman('docs/postman/chapa-payment-verification-publication.postman_collection.json',base,actors,id);console.log('PASS: Postman verification/publication requests');}
    else{
     const vars:Record<string,string>={id};const replace=(v:string)=>v.replace(/\{\{(\w+)\}\}/g,(_m,k:string)=>{assert.ok(vars[k]);return vars[k]!;});
     for(const c of verificationScenarios){
      stage='curl '+c.name;const lines=['request = '+JSON.stringify(c.method)];
      if(c.actor)lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors[c.actor].token));
      if(c.match)lines.push('header = '+JSON.stringify('If-Match: '+replace(c.match)));
      if(c.body!==undefined)lines.push('header = "Content-Type: application/json"','data = '+JSON.stringify(JSON.stringify(c.body)));
      const raw=await privateListingCommand('curl.exe',['--silent','--show-error','--max-time','90','--config','-','--write-out','\n%{http_code}',base+replace(c.path)],lines.join('\n'));
      const split=raw.lastIndexOf('\n');status=Number(raw.slice(split+1));const body=JSON.parse(raw.slice(0,split));assert.equal(status,c.status);
      if(c.error)assert.equal(body.error?.code,c.error);
      else{const value=body.listing??body;assert.equal(value.status,c.listingStatus);if(c.method==='POST'){assert.equal(value.payment.status,c.paymentStatus??'SUCCEEDED');assert.equal(value.payment.amountMinor,'50000');assert.equal(value.payment.currency,'ETB');assert.equal(Boolean(value.payment.paidAt),!c.paymentStatus);assert.equal(Boolean(value.publishedAt),c.listingStatus==='PUBLISHED');}
       for(const[k,field]of Object.entries(c.capture??{}))vars[k]=value[field];}
      console.log('PASS: '+stage+'; HTTP '+status);
     }
    }
   });
   stage=mode+' Neon inspection';status=undefined;
   const row=await db.listing.findUniqueOrThrow({where:{id}}),p=await db.payment.findUniqueOrThrow({where:{id:payment.id}});
   assert.equal(calls,5);assert.equal(row.status,'PUBLISHED');assert.ok(row.publishedAt);
   assert.equal(p.status,'SUCCEEDED');assert.ok(p.paidAt);assert.equal(p.feeQuoteId,quote.id);assert.equal(p.amountMinor,50000n);assert.equal(p.currency,'ETB');assert.equal(p.refundedAmountMinor,0n);
   assert.deepEqual({...p,status:payment.status,paidAt:payment.paidAt,updatedAt:payment.updatedAt},payment);
   assert.deepEqual(previewFacts({...row,publishedAt:before.publishedAt}),previewFacts(before));assert.deepEqual(await db.listingFeeQuote.findUniqueOrThrow({where:{id:quote.id}}),quote);assert.equal(await db.payment.count({where:{listingId:id}}),1);
   console.log('PASS: '+stage+'; one bound successful payment, publication, preserved facts/quote');stage='fixture cleanup';
  },{async initialize(){return {checkoutUrl:'https://checkout.chapa.co/checkout/payment/local-verification-fixture'};}});
  console.log('PASS: fixture cleanup');
 }
}
main().catch(()=>{console.error(JSON.stringify({stage,...(status===undefined?{}:{status}),code:'LOCAL_VERIFICATION_FAILED'}));process.exitCode=1;});
