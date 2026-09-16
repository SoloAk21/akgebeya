import assert from 'node:assert/strict';
import test from 'node:test';
import { createChapaGateway, validChapaCheckout } from '../apps/api/src/chapa.ts';

const input = { amount: '1000.00', currency: 'ETB', reference: 'akg-12345678-1234-1234-1234-123456789abc', returnUrl: 'http://127.0.0.1:3000/' };
const checkoutUrl = 'https://checkout.chapa.co/checkout/payment/test_123';
const key = () => 'CHASECK_TEST-syntheticOnly123';
test('Chapa sends only server payment facts to a fixed endpoint with a server-only test key', async () => {
  let calls = 0;
  const gateway = createChapaGateway({key,fetch:async (url, options) => {
    calls++; assert.equal(url,'https://api.chapa.co/v1/transaction/initialize');
    assert.equal(options.headers.Authorization,`Bearer ${key()}`); assert.equal(options.redirect,'error');
    assert.deepEqual(JSON.parse(options.body),{amount:'1000.00',currency:'ETB',tx_ref:input.reference,return_url:input.returnUrl,customization:{title:'AkGebeya',description:'Test listing fee'}});
    return globalThis.Response.json({status:'success',data:{checkout_url:checkoutUrl}});
  }});
  gateway.assertConfigured(); assert.deepEqual(await gateway.initialize(input),{checkoutUrl}); assert.equal(calls,1);
});
test('missing, public and live keys fail before contacting Chapa', async () => {
  for (const secret of [undefined,'','CHASECK-live123','CHAPUBK_TEST-public123','CHAPA_LIVE_newformat','CHAPA_TEST_v2format']) {
    let calls=0; const gateway=createChapaGateway({key:()=>secret,fetch:async()=>{calls++; throw new Error('unexpected');}});
    assert.throws(()=>gateway.assertConfigured(),{code:'CHAPA_NOT_CONFIGURED'});
    await assert.rejects(gateway.initialize(input),{code:'CHAPA_NOT_CONFIGURED'}); assert.equal(calls,0);
  }
});
test('checkout redirect validation rejects lookalikes, credentials, query redirects and unsafe paths', () => {
  assert.equal(validChapaCheckout(checkoutUrl),true);
  assert.equal(validChapaCheckout('https://checkout.chapa.co/payment/abc'),true);
  for (const value of ['http://checkout.chapa.co/payment/a','https://checkout.chapa.co.evil.test/payment/a','https://user@checkout.chapa.co/payment/a','https://checkout.chapa.co:444/payment/a','https://checkout.chapa.co/payment/a?next=https://evil.test','https://checkout.chapa.co/payment/a#x','https://checkout.chapa.co/payment/../x','javascript:alert(1)',null]) assert.equal(validChapaCheckout(value),false);
});
test('ambiguous Chapa outcomes stay unknown and provider details are sanitized', async () => {
  for (const response of [new globalThis.Response('private provider error',{status:500}),globalThis.Response.json({status:'success',data:{checkout_url:'https://evil.test'}}),new globalThis.Response('not JSON'),new globalThis.Response('x'.repeat(17000))]) {
    const gateway=createChapaGateway({key,fetch:async()=>response});
    await assert.rejects(gateway.initialize(input),error=>error.outcome==='UNKNOWN' && !error.message.includes('private provider'));
  }
  const rejected=createChapaGateway({key,fetch:async()=>new globalThis.Response('secret',{status:401})});
  await assert.rejects(rejected.initialize(input),error=>error.outcome==='FAILED' && !error.message.includes('secret'));
  let calls=0; const network=createChapaGateway({key,fetch:async()=>{calls++;throw new Error('private network details');}});
  await assert.rejects(network.initialize(input),{outcome:'UNKNOWN'}); assert.equal(calls,1);
});

test('timeout aborts one initialization without retrying an uncertain transaction', async () => {
  let calls=0;
  const keepAlive=globalThis.setInterval(()=>{},1000);
  try {
    const gateway=createChapaGateway({key,timeoutMs:10,fetch:async(_url,{signal})=>{
      calls++;
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
    }});
    await assert.rejects(gateway.initialize(input),{code:'CHAPA_RESULT_UNKNOWN',outcome:'UNKNOWN'});
    assert.equal(calls,1);
  } finally { globalThis.clearInterval(keepAlive); }
});
