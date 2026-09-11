import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import { providerFixture } from './provider-fixture.js';
import { ProviderRole } from '../src/generated/prisma/enums.js';
import { requireVerifiedProvider } from '../src/providers/middleware.js';
import { authenticate } from '../src/auth/middleware.js';
import { createApp } from '../src/app.js';
import { parseConfig, parseProviderConfig } from '../src/config.js';
import { errorHandler, HttpError } from '../src/errors.js';
import { withServer } from './helpers.js';
const denied = (code: string) => (e: unknown) => e instanceof HttpError && e.code === code;
const input = { role: 'OWNER', nameEn: 'Provider test', nameAm: '????' };

test('provider roles, localization, duplicate profile and untrusted fields', async () => {
  for (const role of Object.values(ProviderRole)) {
    const f=providerFixture(); const p=await f.providerService.create(f.context,{...input,role});
    assert.equal(p.role,role); assert.equal(p.nameAm,input.nameAm); assert.equal(p.verification.state,'UNVERIFIED');
    await assert.rejects(()=>f.providerService.create(f.context,input),denied('PROVIDER_CONFLICT'));
  }
  const f=providerFixture();
  for(const bad of [{...input,role:'ADMIN'},{...input,role:undefined},{...input,userId:randomUUID()},
    {...input,status:'ACTIVE'},{...input,verified:true},{...input,nameEn:' '}]) {
    await assert.rejects(()=>f.providerService.create(f.context,bad),denied('BAD_REQUEST'));
  }
});
test('provider submission, rejection, resubmission, stale decision, approval and persisted state', async()=>{
  const f=providerFixture(),s=f.providerService; const p=await s.create(f.context,input); const v=await s.submit(f.context);
  assert.equal(v.state,'PENDING'); await assert.rejects(()=>s.submit(f.context),denied('PROVIDER_CONFLICT'));
  assert.equal((await s.decide(f.adminContext,p.id,{verificationId:v.id},false)).state,'REJECTED');
  await assert.rejects(()=>s.requireVerified(f.context,['OWNER']),denied('FORBIDDEN'));
  const next=await s.submit(f.context); assert.notEqual(next.id,v.id);
  await assert.rejects(()=>s.decide(f.adminContext,p.id,{verificationId:v.id},true),denied('PROVIDER_CONFLICT'));
  const approved=await s.decide(f.adminContext,p.id,{verificationId:next.id},true);
  assert.equal(approved.state,'VERIFIED'); assert.ok(approved.reviewedAt);
  assert.equal(await s.requireVerified(f.context,['OWNER']),p.id); assert.equal((await s.me(f.context)).status,'ACTIVE');
  await assert.rejects(()=>s.submit(f.context),denied('PROVIDER_CONFLICT'));
  await assert.rejects(()=>s.decide(f.adminContext,p.id,{verificationId:next.id},false),denied('PROVIDER_CONFLICT'));
});
test('provider admin checks reject normal users, self decisions and a stale elevated context',async()=>{
  const f=providerFixture(),s=f.providerService; const p=await s.create(f.context,input); const v=await s.submit(f.context);
  await assert.rejects(()=>s.decide(f.context,p.id,{verificationId:v.id},true),denied('FORBIDDEN'));
  await assert.rejects(()=>s.decide({...f.context,user:{...f.context.user,role:'ADMIN'}},p.id,{verificationId:v.id},false),denied('FORBIDDEN'));
  const stale={...f.adminContext,user:{...f.adminContext.user}};
  f.repository.users.get(f.adminContext.user.id)!.role='USER';
  await assert.rejects(()=>s.decide(stale,p.id,{verificationId:v.id},true),denied('FORBIDDEN'));
});
test('provider capability rejects wrong ownership, wrong role, null role, suspension and expiration',async()=>{
  const f=providerFixture(),s=f.providerService; const p=await s.create(f.context,input);
  await assert.rejects(()=>s.requireVerified(f.context,['OWNER']),denied('FORBIDDEN'));
  const v=await s.submit(f.context); await s.decide(f.adminContext,p.id,{verificationId:v.id},true);
  await assert.rejects(()=>s.requireVerified(f.otherContext,['OWNER'],p.id),denied('FORBIDDEN'));
  await assert.rejects(()=>s.requireVerified(f.context,['OWNER'],randomUUID()),denied('FORBIDDEN'));
  await assert.rejects(()=>s.requireVerified(f.context,['BROKER']),denied('FORBIDDEN'));
  const row=f.records.get(p.id)!; row.status='SUSPENDED';
  await assert.rejects(()=>s.requireVerified(f.context,['OWNER']),denied('FORBIDDEN'));
  assert.equal((await s.me(f.context)).verification.verified,false);
  row.status='ACTIVE'; row.role=null;
  await assert.rejects(()=>s.requireVerified(f.context,['OWNER']),denied('FORBIDDEN'));
  row.role='OWNER'; f.setNow(new Date(row.review!.expiresAt));
  await assert.rejects(()=>s.requireVerified(f.context,['OWNER']),denied('FORBIDDEN'));
});
test('expired pending review replacement and suspended submission/decision rejection',async()=>{
  const f=providerFixture(),s=f.providerService; const p=await s.create(f.context,input); const v=await s.submit(f.context);
  f.setNow(new Date(v.expiresAt!));
  await assert.rejects(()=>s.decide(f.adminContext,p.id,{verificationId:v.id},true),denied('PROVIDER_CONFLICT'));
  const next=await s.submit(f.context); assert.notEqual(next.id,v.id);
  f.records.get(p.id)!.status='SUSPENDED';
  await assert.rejects(()=>s.submit(f.context),denied('FORBIDDEN'));
  await assert.rejects(()=>s.decide(f.adminContext,p.id,{verificationId:next.id},true),denied('FORBIDDEN'));
});
test('provider HTTP authentication, validation, no-store responses and rejection of role/ownership injection',async()=>{
  const f=providerFixture(); const app=createApp(parseConfig({}),f.service,undefined,undefined,undefined,f.providerService);
  await withServer(app,async base=>{
    const path=base+'/api/v1';
    let r=await fetch(path+'/providers',{method:'POST'}); assert.equal(r.status,401); await r.arrayBuffer();
    const token=(await f.service.createSessionForVerifiedUser(f.user.id)).token;
    const headers={authorization:'Bearer '+token,'content-type':'application/json'};
    r=await fetch(path+'/providers',{method:'POST',headers,body:JSON.stringify({...input,role:'INVALID'})}); assert.equal(r.status,400); await r.arrayBuffer();
    r=await fetch(path+'/providers',{method:'POST',headers,body:JSON.stringify(input)}); assert.equal(r.status,201);
    const body=await r.json() as {provider:{id:string}}; assert.ok(!JSON.stringify(body).includes('userId'));
    r=await fetch(path+'/providers/me/verification',{method:'POST',headers,body:JSON.stringify({userId:f.otherContext.user.id})}); assert.equal(r.status,400); await r.arrayBuffer();
    r=await fetch(path+'/providers/me/verification',{method:'POST',headers:{...headers,'content-type':'text/plain'},body:'unexpected'}); assert.equal(r.status,400); await r.arrayBuffer();
    r=await fetch(path+'/providers/me/verification',{method:'POST',headers,body:'{}'}); assert.equal(r.status,201);
    const review=await r.json() as {verification:{id:string}};
    r=await fetch(path+'/admin/providers/'+body.provider.id+'/verification/approve',{method:'POST',headers:{...headers,'x-role':'ADMIN'},body:JSON.stringify({verificationId:review.verification.id})});
    assert.equal(r.status,403); assert.deepEqual(await r.json(),{error:{code:'FORBIDDEN',message:'Access denied'}});
    r=await fetch(path+'/providers/me',{headers}); assert.equal(r.status,200); assert.equal(r.headers.get('cache-control'),'no-store'); await r.arrayBuffer();
  });
});
test('provider middleware requires authenticated verified owner; no public test endpoint is needed',async()=>{
  const f=providerFixture(),s=f.providerService; const p=await s.create(f.context,input);
  const app=express(); app.get('/gate',authenticate(f.service),requireVerifiedProvider(s,'OWNER'),(_req,res)=>res.json({ok:true}));
  app.get('/missing',requireVerifiedProvider(s,'OWNER'),(_req,res)=>res.json({ok:true})); app.use(errorHandler);
  await withServer(app,async base=>{
    const token=(await f.service.createSessionForVerifiedUser(f.user.id)).token;
    let r=await fetch(base+'/missing'); assert.equal(r.status,401); await r.arrayBuffer();
    r=await fetch(base+'/gate',{headers:{authorization:'Bearer '+token}}); assert.equal(r.status,403); await r.arrayBuffer();
    const v=await s.submit(f.context); await s.decide(f.adminContext,p.id,{verificationId:v.id},true);
    r=await fetch(base+'/gate',{headers:{authorization:'Bearer '+token}}); assert.equal(r.status,200); await r.arrayBuffer();
  });
  assert.throws(()=>requireVerifiedProvider(s));
});
test('provider configuration bounds expiration and uses safe errors',()=>{
  assert.equal(parseProviderConfig({}).pendingTtlSeconds,604800);
  for(const value of ['0','invalid','999999999']) assert.throws(()=>parseProviderConfig({PROVIDER_PENDING_TTL_SECONDS:value}),/^Error: Invalid provider verification configuration$/);
});
