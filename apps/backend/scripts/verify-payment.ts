import assert from 'node:assert/strict';
import {loadConfig,loadChapaConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {HttpChapaClient} from '../src/payments/chapa-client.js';
import {withServer} from '../test/helpers.js';
import {withPaymentDatabaseFixture} from '../test/payment-database-fixture.js';
import {previewFacts} from '../test/preview-database-fixture.js';
import {privateListingCommand,runListingPostman} from './private-listing-command.js';
import {paymentScenarios} from './payment-scenarios.js';
let stage='configuration',status:number|undefined;
async function main(){
 const config=loadConfig();if(config.nodeEnv==='production')throw new Error('DEVELOPMENT_ONLY');
 const real=process.argv.includes('--real');
 const chapa=loadChapaConfig();
 if(real){
  console.log(JSON.stringify({secretConfigured:Boolean(chapa.secretKey),baseUrlConfigured:Boolean(chapa.baseUrl),callbackConfigured:Boolean(chapa.callbackUrl),returnConfigured:Boolean(chapa.returnUrl)}));
  stage='private Chapa configuration';
  if(!chapa.secretKey||!chapa.baseUrl||!chapa.callbackUrl||!chapa.returnUrl)throw new Error('CONFIGURATION_REQUIRED');
  stage='development test credential validation';
  if(!/^CHASECK_TEST-/.test(chapa.secretKey))throw new Error('TEST_CREDENTIAL_REQUIRED');
 }
 for(const mode of real?['curl'] as const:['curl','Postman'] as const){
  stage=mode+' fixture';let calls=0;
  const client={async initialize(input:Parameters<HttpChapaClient['initialize']>[0]){calls++;assert.equal(input.amountMinor,50000n);assert.equal(input.currency,'ETB');assert.match(input.txRef,/^akg-[a-f0-9-]{36}$/);if(calls>1)throw new Error('SECOND_INITIALIZATION_FORBIDDEN');return real?new HttpChapaClient(chapa).initialize(input):{checkoutUrl:'https://checkout.chapa.co/checkout/payment/local-manual-fixture'};}};
  await withPaymentDatabaseFixture(async f=>{
   const {db,actors,paymentListingId:id}=f;
   const before=await db.listing.findUniqueOrThrow({where:{id}}),quote=await db.listingFeeQuote.findUniqueOrThrow({where:{listingId:id}}),sourceRevision=(await f.paymentService.get(actors.owner.context,id)).etag;
   await withServer(createApp(config,f.auth,undefined,undefined,undefined,f.service,f.paymentService),async address=>{
    const base=address+'/api/v1/listings';
    if(mode==='Postman'){stage='Postman requests';await runListingPostman('docs/postman/chapa-payment-initiation.postman_collection.json',base,actors,id);console.log('PASS: Postman payment requests');}
    else{
     const variables:Record<string,string>={id};const replace=(v:string)=>v.replace(/\{\{(\w+)\}\}/g,(_m,k:string)=>{assert.ok(variables[k]);return variables[k]!;});
     for(const scenario of paymentScenarios){
      stage='curl '+scenario.name;status=undefined;const path=replace(scenario.path);
      const lines=['request = '+JSON.stringify(scenario.method)];
      if(scenario.actor)lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors[scenario.actor].token));
      if(scenario.match)lines.push('header = '+JSON.stringify('If-Match: '+replace(scenario.match)));
      if(scenario.body!==undefined)lines.push('header = "Content-Type: application/json"','data = '+JSON.stringify(JSON.stringify(scenario.body)));
      const raw=await privateListingCommand('curl.exe',['--silent','--show-error','--max-time','90','--config','-','--write-out','\n%{http_code}',base+path],lines.join('\n'));
      const split=raw.lastIndexOf('\n');status=Number(raw.slice(split+1));const body=JSON.parse(raw.slice(0,split));
      assert.equal(status,scenario.status);
      if(scenario.error)assert.equal(body.error?.code,scenario.error);
      else{const result=body.listing??body;assert.equal(result.status,scenario.listingStatus);if(path.endsWith('/payment')){assert.equal(result.payment.amountMinor,'50000');assert.equal(result.payment.currency,'ETB');assert.equal(result.payment.status,'PENDING');}
       for(const[k,field]of Object.entries(scenario.capture??{})){assert.equal(typeof result[field],'string');variables[k]=result[field];}
      }
      console.log('PASS: '+stage+'; HTTP '+status);
     }
    }
   });
   stage=mode+' Neon inspection';status=undefined;
   const row=await db.listing.findUniqueOrThrow({where:{id}}),payments=await db.payment.findMany({where:{listingId:id}});assert.equal(payments.length,1);const p=payments[0]!;
   assert.equal(calls,1);assert.equal(row.status,'PAYMENT');assert.equal(row.publishedAt,null);assert.deepEqual(previewFacts(row),previewFacts(before));
   assert.equal(p.feeQuoteId,quote.id);assert.equal(p.sourceRevision,sourceRevision);assert.equal(p.userId,actors.owner.id);assert.equal(p.gateway,'CHAPA');assert.equal(p.amountMinor,50000n);assert.equal(p.currency,'ETB');assert.equal(p.status,'PENDING');assert.equal(p.initializationStatus,'INITIALIZED');assert.equal(p.paidAt,null);assert.equal(p.refundedAmountMinor,0n);assert.ok(p.checkoutUrl);assert.ok(p.gatewayReference);assert.ok(p.idempotencyKey);
   assert.deepEqual(await db.listingFeeQuote.findUniqueOrThrow({where:{id:quote.id}}),quote);
   console.log('PASS: '+mode+' Neon payment binding, pending state, immutable quote/facts; no publication');stage='fixture cleanup';
  },client);
  console.log('PASS: fixture cleanup');
 }
}
main().catch((error:unknown)=>{const code=error instanceof Error&&['CONFIGURATION_REQUIRED','TEST_CREDENTIAL_REQUIRED','DEVELOPMENT_ONLY'].includes(error.message)?error.message:'PAYMENT_VERIFICATION_FAILED';console.error(JSON.stringify({stage,...(status===undefined?{}:{status}),code,reason:'Safe verification check failed; no sensitive output'}));process.exitCode=1;});
