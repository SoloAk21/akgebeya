import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {HttpChapaClient} from '../src/payments/chapa-client.js';
import {ChapaVerificationFailure} from '../src/payments/verification-client.js';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHmac,randomBytes} from 'node:crypto';
import {completionFixture} from './completion-fixture.js';
import {aiOutput} from './ai-fixture.js';
import {ListingService,etag} from '../src/listings/service.js';
import {PaymentVerificationService} from '../src/payments/verification-service.js';
import {PaymentWebhookService} from '../src/payments/webhook-service.js';
import {parseChapaWebhookConfig,parseChapaConfig,parseConfig} from '../src/config.js';
import {createApp} from '../src/app.js';
import {withServer} from './helpers.js';
import {HttpError} from '../src/errors.js';
import type {VerifiedTransaction} from '../src/payments/verification-client.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
async function fixture(){
 const f=await completionFixture();Object.assign(f.row,aiOutput,{status:'PREVIEW'});
 await f.listingService.calculateFee(f.context,f.row.id,etag(f.row));
 await new ListingService(f.repository,undefined,{async initialize(){return {checkoutUrl:'https://checkout.chapa.co/checkout/payment/local-webhook'};}}).payment(f.context,f.row.id,etag(f.row));
 const p=[...f.payments.values()][0]!,secret=randomBytes(32).toString('base64url');let calls=0,lookups=0;
 let output:VerifiedTransaction={status:'success',txRef:p.gatewayReference!,amountMinor:50000n,currency:'ETB'};
 let fail=false;
 const client={async verify(ref:string){calls++;assert.equal(ref,p.gatewayReference);await f.repository.withProvider(f.context.user.id,async()=>{});if(fail)throw new Error('PRIVATE_UPSTREAM_PAYLOAD');return output;}};
 const verify=new PaymentVerificationService(f.repository,client);
 const lookup={async findByReference(ref:string){lookups++;return ref===p.gatewayReference?{id:p.id,userId:p.userId,listingId:p.listingId!,gatewayReference:p.gatewayReference!}:null;}};
 const webhook=new PaymentWebhookService(lookup,verify,secret);
 const body={event:'charge.success',tx_ref:p.gatewayReference,status:'failed',amount:'1',currency:'USD',userId:f.otherContext.user.id};
 const sign=(payload:unknown)=>({payload:createHmac('sha256',secret).update(JSON.stringify(payload)).digest('hex'),chapa:undefined});
 return {...f,p,verify,lookup,webhook,secret,body,sign,calls:()=>calls,lookups:()=>lookups,set:(patch:Partial<VerifiedTransaction>)=>{output={...output,...patch};},network:()=>{fail=true;}};
}
test('standard Chapa HMAC variants, unknown references and unsupported events; never trusts payload facts',async()=>{
 const f=await fixture();
 for(const headers of [{chapa:undefined,payload:undefined},{chapa:'bad',payload:'0'.repeat(64)},{chapa:['0'.repeat(64)],payload:undefined}])await assert.rejects(()=>f.webhook.receive(f.body,headers),denied('WEBHOOK_UNAUTHORIZED'));
 assert.equal(f.lookups(),0);assert.equal(f.calls(),0);
 const unknown={event:'charge.success',tx_ref:'unknown'};await f.webhook.receive(unknown,f.sign(unknown));assert.equal(f.calls(),0);
 const ignored={event:'charge.refunded'};await f.webhook.receive(ignored,f.sign(ignored));assert.equal(f.calls(),0);
 const headers={chapa:createHmac('sha256',f.secret).update(f.secret).digest('hex'),payload:'bad'};
 await f.webhook.receive(f.body,headers);assert.equal(f.p.status,'SUCCEEDED');assert.equal(f.row.status,'VERIFY_PAYMENT');assert.equal(f.p.amountMinor,50000n);assert.equal(f.p.currency,'ETB');
 assert.equal(f.notifications.length,1);assert.ok(f.notifications[0]!.titleAm);assert.ok(f.notifications[0]!.bodyAm);assert.equal(f.row.publishedAt,null);
 await f.webhook.receive({...f.body,event:'charge.failed'},f.sign({...f.body,event:'charge.failed'}));await f.verify.verify(f.context,f.row.id);
 assert.equal(f.calls(),1);assert.equal(f.notifications.length,1);assert.equal(f.payments.size,1);
 await f.verify.publish(f.context,f.row.id,etag(f.row));await f.webhook.receive(f.body,f.sign(f.body));assert.equal(f.row.status,'PUBLISHED');assert.equal(f.notifications.length,1);
});
test('malformed and tampered signed webhook is rejected without gateway calls',async()=>{
 const f=await fixture();
 for(const body of [null,[],{}, {event:1},{event:'charge.success'},{event:'charge.failed',tx_ref:''},{event:'charge.success',tx_ref:'bad/reference'}])await assert.rejects(()=>f.webhook.receive(body,f.sign(body)),denied('BAD_REQUEST'));
 await assert.rejects(()=>f.webhook.receive({...f.body,tx_ref:'tampered'},f.sign(f.body)),denied('WEBHOOK_UNAUTHORIZED'));
 assert.equal(f.calls(),0);assert.equal(f.notifications.length,0);
});
test('pending/failure/recovery, mismatches and ambiguity produce only authoritative transition notifications',async()=>{
 const f=await fixture();f.set({status:'pending'});await f.webhook.receive(f.body,f.sign(f.body));assert.equal(f.notifications.length,0);
 await assert.rejects(()=>f.verify.publish(f.context,f.row.id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));
 f.set({status:'failed'});await f.webhook.receive(f.body,f.sign(f.body));await f.verify.verify(f.context,f.row.id);assert.equal(f.notifications.length,1);assert.equal(f.p.status,'FAILED');
 f.set({status:'pending'});await f.webhook.receive(f.body,f.sign(f.body));assert.equal(f.p.status,'FAILED');assert.equal(f.notifications.length,1);
 for(const patch of [{amountMinor:1n},{currency:'USD'},{txRef:'other'}]){f.set({status:'success',amountMinor:50000n,currency:'ETB',txRef:f.p.gatewayReference!,...patch});await assert.rejects(()=>f.webhook.receive(f.body,f.sign(f.body)),denied('PAYMENT_VERIFICATION_MISMATCH'));assert.equal(f.notifications.length,1);}
 f.set({status:'success',amountMinor:50000n,currency:'ETB',txRef:f.p.gatewayReference!});await f.webhook.receive(f.body,f.sign(f.body));assert.equal(f.notifications.length,2);
 const g=await fixture();g.network();await assert.rejects(()=>g.webhook.receive(g.body,g.sign(g.body)),denied('PAYMENT_VERIFICATION_UNAVAILABLE'));assert.equal(g.notifications.length,0);assert.equal(g.p.status,'PENDING');
});
test('concurrent webhook/manual reconciliation and suspended provider payment truth preserve exactly-once notifications',async()=>{
 const f=await fixture();await Promise.all([f.webhook.receive(f.body,f.sign(f.body)),f.verify.verify(f.context,f.row.id),f.webhook.receive(f.body,f.sign(f.body))]);assert.equal(f.notifications.length,1);assert.equal(f.payments.size,1);
 for(const state of ['RESERVED','UNKNOWN'] as const){const g=await fixture();Object.assign(g.p,{initializationStatus:state,checkoutUrl:null});g.row.status='CALCULATE_FEE';g.records.get(g.ownerProvider.id)!.status='SUSPENDED';await g.webhook.receive(g.body,g.sign(g.body));assert.equal(g.p.status,'SUCCEEDED');assert.equal(g.notifications.length,1);await assert.rejects(()=>g.verify.publish(g.context,g.row.id,etag(g.row)),denied('FORBIDDEN'));assert.equal(g.row.publishedAt,null);}
});
test('webhook HTTP privacy, deterministic responses, body limit and unavailable configuration',async()=>{
 const f=await fixture();const app=createApp(parseConfig({NODE_ENV:'test'}),f.service,undefined,undefined,undefined,undefined,undefined,f.webhook);
 await withServer(app,async base=>{
  const send=(body:string,headers:Record<string,string>={})=>fetch(base+'/api/v1/payments/webhooks/chapa',{method:'POST',headers:{'content-type':'application/json',...headers},body});
  const invalid=await send(JSON.stringify(f.body));assert.equal(invalid.status,401);assert.equal(invalid.headers.get('www-authenticate'),null);
  assert.equal((await send('{')).status,400);assert.equal((await send(JSON.stringify({x:'x'.repeat(17000)}))).status,413);
  const success=await send(JSON.stringify(f.body),{'x-chapa-signature':f.sign(f.body).payload});assert.equal(success.status,200);assert.deepEqual(await success.json(),{status:'ok'});
 });
 await assert.rejects(()=>new PaymentWebhookService(f.lookup,f.verify).receive(f.body,f.sign(f.body)),denied('SERVICE_UNAVAILABLE'));
 assert.equal(parseChapaWebhookConfig({}).secret,undefined);
 for(const value of ['short','bad secret'.repeat(8)])assert.throws(()=>parseChapaWebhookConfig({CHAPA_WEBHOOK_SECRET:value}),e=>e instanceof Error&&!e.message.includes(value));
 assert.equal(parseChapaWebhookConfig({CHAPA_WEBHOOK_SECRET:f.secret}).secret,f.secret);
});

test('server verification rejects missing/mismatched gateway mode and strips sensitive upstream fields',async()=>{
 const config={secretKey:'CHASECK_TEST-'+randomBytes(24).toString('hex'),baseUrl:'https://api.chapa.co/v1' as const,callbackUrl:undefined,returnUrl:undefined,timeoutMs:100};
 for(const mode of [undefined,'live','test']){
  const client=new HttpChapaClient(config,async()=>Response.json({status:'success',data:{mode,status:'success',tx_ref:'local-reference',amount:'500.00',currency:'ETB',email:'private-marker',mobile:'private-marker'}}));
  if(mode==='test')assert.deepEqual(await client.verify('local-reference'),{status:'success',txRef:'local-reference',amountMinor:50000n,currency:'ETB'});
  else await assert.rejects(()=>client.verify('local-reference'),ChapaVerificationFailure);
 }
});

test('notification copy contains distinct English and genuine Amharic text',async()=>{
 const {paymentNotification}=await import('../src/payments/notifications.js');
 for(const status of ['SUCCEEDED','FAILED'] as const){const n=paymentNotification(status);for(const text of [n.titleAm,n.bodyAm]){assert.match(text,/\p{Script=Ethiopic}/u);assert.doesNotMatch(text,/[A-Za-z?]/);}for(const text of [n.titleEn,n.bodyEn])assert.doesNotMatch(text,/\p{Script=Ethiopic}/u);}
});

test('authoritative cancelled variants map to failure; event labels alone cannot settle',async()=>{
 const config={secretKey:'local-private-test-key',baseUrl:'https://api.chapa.co/v1' as const,callbackUrl:undefined,returnUrl:undefined,timeoutMs:100};
 for(const status of ['cancelled','failed/cancelled']){const client=new HttpChapaClient(config,async()=>Response.json({status:'success',data:{mode:'live',status,tx_ref:'local-reference',amount:'500.00',currency:'ETB'}}));assert.equal((await client.verify('local-reference')).status,'failed');}
 const f=await fixture();f.set({status:'pending'});const body={event:'charge.failed/cancelled',tx_ref:f.p.gatewayReference};await f.webhook.receive(body,f.sign(body));assert.equal(f.p.status,'PENDING');assert.equal(f.notifications.length,0);
});

test('production configuration rejects TEST payment keys without exposing them',()=>{
 const key='CHASECK_TEST-'+randomBytes(32).toString('base64url');
 assert.throws(()=>parseChapaConfig({NODE_ENV:'production',CHAPA_SECRET_KEY:key}),error=>error instanceof Error&&error.message==='Invalid Chapa configuration'&&!error.message.includes(key));
 assert.equal(parseChapaConfig({NODE_ENV:'development',CHAPA_SECRET_KEY:key}).secretKey,key);
});

test('deterministic manual runner rejects a real-mode flag before loading credentials or opening fixtures',()=>{
 const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../scripts/verify-webhook.ts',import.meta.url)),'--real'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,DATABASE_URL:'invalid-private-marker',DIRECT_URL:'invalid-private-marker'},windowsHide:true,encoding:'utf8',timeout:15000});
 assert.equal(result.status,1);const output=result.stdout+result.stderr;assert.ok(output.includes('"stage":"arguments"'));assert.ok(!output.includes('invalid-private-marker'));assert.ok(!output.includes('PASS:'));
});
