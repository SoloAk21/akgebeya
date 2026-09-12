import assert from 'node:assert/strict';
import {test} from 'node:test';
import {completionFixture} from './completion-fixture.js';
import {aiOutput} from './ai-fixture.js';
import {ListingService,etag} from '../src/listings/service.js';
import {ChapaFailure} from '../src/payments/client.js';
import {HttpError} from '../src/errors.js';
const denied=(code:string)=>(e:unknown)=>e instanceof HttpError&&e.code===code;
test('missing client configuration creates no reservation and unresolved diagnostic writes leave RESERVED blocking duplicates',async()=>{
 const f=await completionFixture();Object.assign(f.row,aiOutput,{status:'PREVIEW'});await f.listingService.calculateFee(f.context,f.row.id,etag(f.row));
 await assert.rejects(()=>f.listingService.payment(f.context,f.row.id,etag(f.row)),denied('SERVICE_UNAVAILABLE'));assert.equal(f.payments.size,0);
 let calls=0;
 const repository={...f.repository,async recordPaymentFailure(){throw new Error('private database detail');}};
 const s=new ListingService(repository,undefined,{async initialize(){calls++;throw new ChapaFailure('UNKNOWN');}});
 await assert.rejects(()=>s.payment(f.context,f.row.id,etag(f.row)),denied('PAYMENT_INITIALIZATION_UNKNOWN'));
 assert.equal([...f.payments.values()][0]!.initializationStatus,'RESERVED');assert.equal(f.row.status,'CALCULATE_FEE');
 await assert.rejects(()=>s.payment(f.context,f.row.id,etag(f.row)),denied('LISTING_TRANSITION_CONFLICT'));assert.equal(calls,1);
});
test('provider suspension during initialization fails closed without returning checkout or exposing upstream details',async()=>{
 const f=await completionFixture();Object.assign(f.row,aiOutput,{status:'PREVIEW'});await f.listingService.calculateFee(f.context,f.row.id,etag(f.row));
 const s=new ListingService(f.repository,undefined,{async initialize(){f.records.get(f.ownerProvider.id)!.status='SUSPENDED';return {checkoutUrl:'https://checkout.chapa.co/checkout/payment/private-test'};}});
 await assert.rejects(()=>s.payment(f.context,f.row.id,etag(f.row)),denied('FORBIDDEN'));
 const p=[...f.payments.values()][0]!;assert.equal(p.initializationStatus,'UNKNOWN');assert.equal(p.checkoutUrl,null);assert.equal(p.status,'PENDING');assert.equal(f.row.status,'CALCULATE_FEE');
});
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('real manual verifier rejects missing/non-test credentials before fixtures and prints only safe diagnostic fields',()=>{
 for(const secret of ['', 'synthetic-private-sentinel']){
  const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(new URL('../scripts/verify-payment.ts',import.meta.url)),'--real'],{windowsHide:true,encoding:'utf8',timeout:15000,env:{...process.env,NODE_ENV:'development',CHAPA_SECRET_KEY:secret,CHAPA_BASE_URL:'https://api.chapa.co/v1',CHAPA_CALLBACK_URL:'https://example.com/callback',CHAPA_RETURN_URL:'https://example.com/return'}});
  assert.equal(result.status,1);assert.ok(!result.stdout.includes('synthetic-private-sentinel'));assert.ok(!result.stderr.includes('synthetic-private-sentinel'));
  const presence=JSON.parse(result.stdout.trim());assert.deepEqual(Object.keys(presence).sort(),['baseUrlConfigured','callbackConfigured','returnConfigured','secretConfigured']);
  assert.ok(Object.values(presence).every(v=>typeof v==='boolean'));
  const diagnostic=JSON.parse(result.stderr.trim());assert.deepEqual(Object.keys(diagnostic).sort(),['code','reason','stage']);assert.equal(diagnostic.code,secret?'TEST_CREDENTIAL_REQUIRED':'CONFIGURATION_REQUIRED');
 }
});
