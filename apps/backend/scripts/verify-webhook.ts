import {z} from 'zod';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
import {loadConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {withServer} from '../test/helpers.js';
import {withPaymentDatabaseFixture} from '../test/payment-database-fixture.js';
import {PaymentVerificationService} from '../src/payments/verification-service.js';
import {PaymentWebhookService} from '../src/payments/webhook-service.js';
import {PrismaPaymentWebhookRepository} from '../src/payments/webhook-repository.js';
import {ListingService} from '../src/listings/service.js';
import {previewFacts} from '../test/preview-database-fixture.js';
import {privateListingCommand,runListingPostman} from './private-listing-command.js';
import {webhookScenarios} from './webhook-scenarios.js';
let stage='configuration',status:number|undefined;
async function main(){
 stage='arguments';z.array(z.enum(['--postman-only'])).max(1).parse(process.argv.slice(2));
 stage='configuration';const config=loadConfig();if(config.nodeEnv==='production')throw new Error('Development only');
 const modes=process.argv.includes('--postman-only')?['Postman'] as const:['curl','Postman'] as const;
 for(const mode of modes){
  stage=mode+' fixture setup';status=undefined;
  await withPaymentDatabaseFixture(async f=>{
   const {db,actors,paymentListingId:id,repository}=f,owner=actors.owner.context;
   await f.paymentService.payment(owner,id,(await f.paymentService.get(owner,id)).etag);
   const before=await db.listing.findUniqueOrThrow({where:{id}}),quote=await db.listingFeeQuote.findUniqueOrThrow({where:{listingId:id}}),payment=await db.payment.findFirstOrThrow({where:{listingId:id}});
   const existing=await db.notification.findMany({where:{userId:owner.user.id},orderBy:{id:'asc'}});
   let calls=0;
   const client={async initialize(){throw new Error('Second payment forbidden');},async verify(ref:string){calls++;assert.equal(ref,payment.gatewayReference);if(calls===5)throw new Error('Controlled ambiguity');return {status:calls===1?'pending' as const:calls===2||calls===3?'failed' as const:'success' as const,txRef:ref,amountMinor:calls===4?1n:50000n,currency:'ETB'};}};
   const secret=randomBytes(32).toString('base64url');
   const webhook=new PaymentWebhookService(new PrismaPaymentWebhookRepository(db),new PaymentVerificationService(repository,client),secret);
   const listings=new ListingService(repository,{async generate(){throw new Error('Gemini forbidden');}},client);
   await withServer(createApp(config,f.auth,undefined,undefined,undefined,f.service,listings,webhook),async address=>{
    const base=address+'/api/v1';
    if(mode==='Postman'){
     stage='Postman webhook cases';await runListingPostman('docs/postman/chapa-webhook.postman_collection.json',base,{...actors,webhook:{token:secret},reference:{token:payment.gatewayReference!}},id);
     console.log('PASS: Postman webhook cases');
    }else{
     const vars:Record<string,string>={id,referenceToken:payment.gatewayReference!};
     const replace=(v:string)=>v.replace(/\{\{(\w+)\}\}/g,(_m,k:string)=>{assert.ok(vars[k]);return vars[k]!;});
     for(const c of webhookScenarios){
      stage='curl '+c.name;
      const body=replace(c.raw??JSON.stringify(c.body??{event:'charge.success',tx_ref:'{{referenceToken}}'}));
      const lines=['request = '+JSON.stringify(c.method??'POST'),'header = "Content-Type: application/json"'];
      if(c.auth==='owner')lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors.owner.token));
      else{
       lines.push('data = '+JSON.stringify(body));
       if(c.auth!=='none'){
        const hash=c.auth==='invalid'?'0'.repeat(64):createHmac('sha256',secret).update(c.auth==='static'?secret:JSON.stringify(JSON.parse(body))).digest('hex');
        lines.push('header = '+JSON.stringify((c.auth==='static'?'chapa-signature':'x-chapa-signature')+': '+hash));
       }
      }
      const raw=await privateListingCommand('curl.exe',['--silent','--show-error','--max-time','90','--config','-','--write-out','\n%{http_code}',base+replace(c.path??'/payments/webhooks/chapa')],lines.join('\n'));
      const split=raw.lastIndexOf('\n');status=Number(raw.slice(split+1));const response=JSON.parse(raw.slice(0,split));assert.equal(status,c.status);
      if(c.error)assert.equal(response.error?.code,c.error);
      else if(c.listingStatus){assert.equal(response.status,c.listingStatus);assert.equal(response.payment.status,'SUCCEEDED');assert.equal(response.payment.amountMinor,'50000');assert.equal(response.publishedAt,null);}
      else assert.deepEqual(response,{status:'ok'});
      console.log('PASS: '+stage+'; HTTP '+status);
     }
    }
   });
   stage=mode+' Neon inspection';status=undefined;
   const row=await db.listing.findUniqueOrThrow({where:{id}}),p=await db.payment.findUniqueOrThrow({where:{id:payment.id}}),notifications=await db.notification.findMany({where:{userId:owner.user.id,type:'PAYMENT'},orderBy:{createdAt:'asc'}});
   assert.equal(calls,6);assert.equal(row.status,'VERIFY_PAYMENT');assert.equal(row.publishedAt,null);assert.equal(p.status,'SUCCEEDED');assert.ok(p.paidAt);
   assert.equal(p.amountMinor,50000n);assert.equal(p.currency,'ETB');assert.equal(p.feeQuoteId,quote.id);assert.equal(await db.payment.count({where:{listingId:id}}),1);
   assert.deepEqual(previewFacts(row),previewFacts(before));assert.deepEqual(await db.listingFeeQuote.findUniqueOrThrow({where:{id:quote.id}}),quote);
   assert.equal(notifications.length,existing.length+2);assert.equal(notifications[0]!.titleEn,'Payment unsuccessful');assert.equal(notifications[1]!.titleEn,'Payment confirmed');
   for(const n of notifications){assert.match(n.titleAm??'',/\p{Script=Ethiopic}/u);assert.match(n.bodyAm??'',/\p{Script=Ethiopic}/u);assert.ok(!JSON.stringify(n).includes(payment.gatewayReference!));assert.ok(!JSON.stringify(n).includes(payment.idempotencyKey));}
   console.log('PASS: '+stage+'; one payment, two distinct outcome notifications, no publication, preserved quote and facts');stage='fixture cleanup';
  },{async initialize(){return {checkoutUrl:'https://checkout.chapa.co/checkout/payment/local-webhook'};}});
  console.log('PASS: fixture cleanup');
 }
}
main().catch((error:unknown)=>{const candidate=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';const reason=['P2028','P1001','P1002','P1017','P2010','ERR_ASSERTION'].includes(candidate)?candidate:'SAFE_CHECK_FAILED';console.error(JSON.stringify({stage,...(status===undefined?{}:{status}),code:'WEBHOOK_MANUAL_VERIFICATION_FAILED',reason}));process.exitCode=1;});
