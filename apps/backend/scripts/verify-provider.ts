import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { loadConfig, loadAuthConfig } from '../src/config.js';
import { ProviderRole } from '../src/generated/prisma/enums.js';
import { authenticate, authenticatedContext } from '../src/auth/middleware.js';
import { requireVerifiedProvider } from '../src/providers/middleware.js';
import { errorHandler } from '../src/errors.js';
import { withProviderDatabaseFixture } from '../test/provider-database-fixture.js';
import { withServer } from '../test/helpers.js';
import { withBuiltServer } from './verification-server.js';
import { providerScenarios } from './provider-scenarios.js';

let stage='development configuration';
const root=fileURLToPath(new URL('../../../',import.meta.url));
async function command(executable:string,args:string[],input='') {
  return new Promise<string>((resolve,reject)=>{
    // CLI subprocesses do not need application secrets.
    const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(key)));
    const child=spawn(executable,args,{windowsHide:true,stdio:['pipe','pipe','pipe'],env});
    let output=''; child.stdout.on('data',part=>{output+=String(part);});
    child.stderr.on('data',()=>{});
    child.once('error',()=>reject(new Error('LOCAL_COMMAND_FAILED')));
    child.once('close',code=>code===0?resolve(output):reject(new Error('LOCAL_COMMAND_FAILED')));
    child.stdin.on('error',()=>{}); child.stdin.end(input);
  });
}
const responseShape=z.object({
  provider:z.object({id:z.string().uuid(),verification:z.object({state:z.string(),verified:z.boolean()})}).passthrough().optional(),
  verification:z.object({id:z.string().uuid().nullable(),state:z.string(),verified:z.boolean()}).passthrough().optional(),
  error:z.object({code:z.string()}).passthrough().optional(),
});
async function verify() {
  if(loadConfig().nodeEnv==='production') throw new Error('DEVELOPMENT_ONLY');
  const authConfig=loadAuthConfig();
  await withBuiltServer({},async authBase=>{
    const base=authBase.replace(/\/auth$/,'');
    for(const mode of ['curl','Postman'] as const) {
      await withProviderDatabaseFixture(async fixture=>{
        const {db,auth,service,actors}=fixture;
        if(mode==='curl') {
          const variables:Record<string,string>={};
          const interpolate=(value:string)=>value.replace(/\{\{(\w+)\}\}/g,(_match,key:string)=>{
            assert.ok(variables[key],'Missing scenario variable'); return variables[key]!;
          });
          for(const scenario of providerScenarios) {
            stage='curl '+scenario.name;
            const lines=['request = '+JSON.stringify(scenario.method),'header = "Content-Type: application/json"'];
            if(scenario.actor) lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors[scenario.actor].token));
            if(scenario.body) lines.push('data = '+JSON.stringify(interpolate(JSON.stringify(scenario.body))));
            const output=await command('curl.exe',['--silent','--show-error','--config','-','--write-out','\n%{http_code}',base+interpolate(scenario.path)],lines.join('\n'));
            const split=output.lastIndexOf('\n');
            assert.equal(Number(output.slice(split+1)),scenario.status,'Unexpected HTTP status');
            const body=responseShape.parse(JSON.parse(output.slice(0,split)));
            if(scenario.error) assert.equal(body.error?.code,scenario.error);
            else {
              const v=body.verification??body.provider?.verification;
              assert.equal(v?.state,scenario.state); assert.equal(v?.verified,scenario.state==='VERIFIED');
            }
            for(const[key,path]of Object.entries(scenario.capture??{})){
              const value=path==='provider.id'?body.provider?.id:body.verification?.id;
              variables[key]=z.string().uuid().parse(value);
            }
          }
          console.log('PASS: curl provider verification (22 requests).');
        } else {
          stage='Postman local collection';
          const key=randomBytes(32).toString('base64url');
          const fixtureApp=express();
          fixtureApp.post('/credentials',(req,res)=>{
            const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+key);
            res.set('Cache-Control','no-store');
            if(req.headers.origin||actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.sendStatus(403);return;}
            res.json({owner:actors.owner.token,other:actors.other.token,admin:actors.admin.token});
          });
          await withServer(fixtureApp,async fixtureUrl=>{
            const template=JSON.parse(await readFile(root+'docs/postman/provider-verification.postman_collection.json','utf8')) as {variable:{key:string;value:string}[]};
            template.variable=[{key:'baseUrl',value:base},{key:'fixtureUrl',value:fixtureUrl},{key:'fixtureKey',value:key}];
            const temporary=root+'.git/provider-manual-'+randomUUID()+'.json';
            try {
              // Only a temporary loopback fixture key is written; never application session tokens.
              await writeFile(temporary,JSON.stringify(template),{flag:'wx'});
              await command(process.execPath,[root+'node_modules/postman-cli/bin/postman.js','collection','run',temporary,'--no-report-events','--silent']);
            } finally { await unlink(temporary); }
          });
          console.log('PASS: Postman provider verification (22 requests).');
        }
        stage=mode+' Neon persistence';
        const owner=await db.provider.findUniqueOrThrow({where:{userId:actors.owner.id}});
        const other=await db.provider.findUniqueOrThrow({where:{userId:actors.other.id}});
        assert.equal(owner.role,'OWNER'); assert.equal(owner.status,'ACTIVE'); assert.equal(other.role,'BROKER');
        const approved=await db.verification.findFirstOrThrow({where:{userId:owner.userId,type:'PROVIDER'}});
        const rejected=await db.verification.findFirstOrThrow({where:{userId:other.userId,type:'PROVIDER'}});
        assert.equal(approved.status,'APPROVED'); assert.equal(rejected.status,'REJECTED');
        assert.equal(approved.reviewerId,actors.admin.id); assert.equal(rejected.reviewerId,actors.admin.id);
        assert.ok(approved.reviewedAt&&rejected.reviewedAt); assert.ok(approved.expiresAt>approved.reviewedAt);
        assert.equal(approved.target,null); assert.equal(approved.tokenHash,null);
        assert.equal(await db.provider.count({where:{userId:actors.owner.id}}),1);
        const sessions=await db.session.findMany({where:{userId:{in:Object.values(actors).map(a=>a.id)}}});
        assert.ok(sessions.every(s=>/^[a-f0-9]{64}$/.test(s.tokenHash)&&!Object.values(actors).some(a=>a.token===s.tokenHash)));
        const indexes=await db.$queryRaw<{indexdef:string}[]>`SELECT indexdef FROM pg_indexes WHERE schemaname='akgebeya' AND indexname='verifications_provider_pending_key'`;
        assert.ok(indexes[0]?.indexdef.includes('UNIQUE')&&indexes[0]?.indexdef.includes('PENDING'));
        stage=mode+' manual RBAC and ownership';
        // A loopback-only test harness exercises the real middleware; no production capability endpoint is added.
        const gate=express();
        gate.get('/capability',authenticate(auth),requireVerifiedProvider(service,...Object.values(ProviderRole)),(_req,res)=>res.json({ok:true}));
        gate.get('/owned/:providerId',authenticate(auth),async(req,res)=>{
          await service.requireVerified(authenticatedContext(req),Object.values(ProviderRole),String(req.params.providerId));
          res.json({ok:true});
        });
        gate.use(errorHandler);
        await service.create(actors.spare.context,{role:'AGENT',nameEn:'Unverified fixture'});
        await withServer(gate,async url=>{
          const check=async(path:string,actor:keyof typeof actors|undefined,status:number)=>{
            const lines=actor?'header = '+JSON.stringify('Authorization: Bearer '+actors[actor].token):'';
            const output=await command('curl.exe',['--silent','--show-error','--config','-','--write-out','\n%{http_code}',url+path],lines);
            assert.equal(Number(output.slice(output.lastIndexOf('\n')+1)),status,'Unexpected capability status');
          };
          await check('/capability',undefined,401);
          await check('/capability','spare',403);
          await check('/capability','other',403);
          await check('/capability','owner',200);
          await check('/owned/'+other.id,'owner',403);
          await db.provider.update({where:{id:owner.id},data:{status:'SUSPENDED'}});
          await check('/capability','owner',403);
          assert.equal((await service.me(actors.owner.context)).verification.verified,false);
          await db.provider.update({where:{id:owner.id},data:{status:'ACTIVE',role:null}});
          await check('/capability','owner',403);
          await db.provider.update({where:{id:owner.id},data:{role:'OWNER'}});
          await check('/capability','owner',200);
        });
        console.log('PASS: '+mode+' Neon ownership, roles, decisions, review timestamps, hash-only sessions and RBAC.');
        stage=mode+' cleanup';
      },authConfig);
      console.log('PASS: '+mode+' temporary provider, verification, user and session records removed; identities preserved.');
    }
  });
}
verify().catch(()=>{console.error(JSON.stringify({stage,code:'PROVIDER_MANUAL_VERIFICATION_FAILED',reason:'Safe assertion or local command failed'}));process.exitCode=1;});
