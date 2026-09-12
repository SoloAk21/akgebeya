import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { readFile,writeFile,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { loadConfig,loadAuthConfig } from '../src/config.js';
import { withBuiltServer } from './verification-server.js';
import { withServer } from '../test/helpers.js';
import { withListingDatabaseFixture } from '../test/listing-database-fixture.js';
import { listingScenarios } from './listing-scenarios.js';
let stage='configuration';let httpStatus:number|undefined;
const root=fileURLToPath(new URL('../../../',import.meta.url));
async function command(executable:string,args:string[],input=''){
 return new Promise<string>((resolve,reject)=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(k)));
  const child=spawn(executable,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';
  child.stdout.on('data',part=>{output+=String(part);});child.stderr.on('data',()=>{});
  child.once('error',()=>reject(new Error('LOCAL_COMMAND_FAILED')));
  child.once('close',code=>code===0?resolve(output):reject(new Error('LOCAL_COMMAND_FAILED')));
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
async function main(){
 if(loadConfig().nodeEnv==='production')throw new Error('DEVELOPMENT_ONLY');
 const config=loadAuthConfig();
 await withBuiltServer({},async authBase=>{
  const base=authBase.replace(/\/auth$/,'/listings');
  for(const mode of ['curl','Postman'] as const){
   await withListingDatabaseFixture(async({db,actors,nonDraftId,locations,providerIds})=>{
    if(mode==='curl'){
     const variables:Record<string,string>={nonDraftId};
     const replace=(value:string)=>value.replace(/\{\{(\w+)\}\}/g,(_m,k:string)=>{assert.ok(variables[k]);return variables[k]!;});
     for(const scenario of listingScenarios){
      stage='curl '+scenario.name;httpStatus=undefined;
      const lines=['request = '+JSON.stringify(scenario.method),'header = "Content-Type: application/json"'];
      if(scenario.actor)lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors[scenario.actor].token));
      if(scenario.match)lines.push('header = '+JSON.stringify('If-Match: '+replace(scenario.match)));
      if(scenario.body!==undefined)lines.push('data = '+JSON.stringify(JSON.stringify(scenario.body)));
      const result=await command('curl.exe',['--silent','--show-error','--config','-','--write-out','\n%{http_code}',base+replace(scenario.path)],lines.join('\n'));
      const split=result.lastIndexOf('\n');httpStatus=Number(result.slice(split+1));assert.equal(httpStatus,scenario.status);
      const body=JSON.parse(result.slice(0,split)) as {error?:{code:string};listing?:Record<string,unknown>;listings?:unknown[];status?:string};
      if(scenario.error)assert.equal(body.error?.code,scenario.error);
      else if(scenario.count!==undefined)assert.equal(body.listings?.length,scenario.count);
      else if(scenario.method==='DELETE')assert.equal(body.status,'ok');
      else{
       assert.equal(body.listing?.status,'DRAFT');
       for(const[k,field]of Object.entries(scenario.capture??{}))variables[k]=z.string().parse(body.listing?.[field]);
       const location=body.listing?.location as {id:string}|null|undefined;if(location)locations.add(location.id);
       if(scenario.name==='Empty draft'){
        const row=await db.listing.findUniqueOrThrow({where:{id:z.string().uuid().parse(body.listing?.id)}});
        for(const field of ['category','type','propertyType','titleEn','titleAm','descriptionEn','descriptionAm','locationId','price','publishedAt'] as const)assert.equal(row[field],null);
       }
      }
     }
     console.log('PASS: curl listing drafts ('+listingScenarios.length+' requests), private access, RBAC and ETags.');
    }else{
     stage='Postman collection';httpStatus=undefined;
     const key=randomBytes(32).toString('base64url'),fixture=express();
     fixture.post('/credentials',(req,res)=>{
      const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+key);res.set('Cache-Control','no-store');
      if(req.headers.origin||actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.sendStatus(403);return;}
      res.json({tokens:Object.fromEntries(Object.entries(actors).map(([name,a])=>[name,a.token])),nonDraftId});
     });
     await withServer(fixture,async fixtureUrl=>{
      const collection=JSON.parse(await readFile(root+'docs/postman/listing-draft.postman_collection.json','utf8')) as {variable:{key:string;value:string}[]};
      collection.variable=[{key:'baseUrl',value:base},{key:'fixtureUrl',value:fixtureUrl},{key:'fixtureKey',value:key}];
      const temporary=root+'.git/listing-manual-'+randomUUID()+'.json';
      try{await writeFile(temporary,JSON.stringify(collection),{flag:'wx'});
       await command(process.execPath,[root+'node_modules/postman-cli/bin/postman.js','collection','run',temporary,'--no-report-events','--silent']);
      }finally{await unlink(temporary);}
     });
     console.log('PASS: Postman listing drafts ('+listingScenarios.length+' requests), private access, RBAC and ETags.');
    }
    stage=mode+' Neon inspection';
    const rows=await db.listing.findMany({where:{providerId:{in:providerIds},status:'DRAFT'}});
    assert.equal(rows.length,4,'Unauthorized creation or missing draft');
    const provider=await db.provider.findUniqueOrThrow({where:{userId:actors.owner.id}});
    assert.ok(rows.every(r=>r.providerId===provider.id&&r.publishedAt===null));
    const deleted=rows.find(r=>r.deletedAt!==null)!;assert.ok(deleted);
    assert.equal(deleted.titleEn,'Draft home');assert.equal(deleted.titleAm,'\u1264\u1275');
    assert.equal(deleted.descriptionEn,null);assert.equal(deleted.descriptionAm,'\u1218\u130d\u1208\u132b');
    assert.equal(deleted.price?.toFixed(2),'1234.50');
    const categoryOnly=rows.find(r=>r.category==='LAND')!;assert.ok(categoryOnly);
    assert.equal(categoryOnly.propertyType,null);assert.equal(categoryOnly.titleEn,null);assert.equal(categoryOnly.locationId,null);assert.equal(categoryOnly.price,null);
    const purposeOnly=rows.find(r=>r.type==='RENT_REQUEST')!;assert.ok(purposeOnly);assert.equal(purposeOnly.category,null);assert.equal(purposeOnly.price,null);
    assert.equal(await db.payment.count({where:{listingId:{in:rows.map(r=>r.id)}}}),0);
    assert.equal(await db.media.count({where:{listingId:{in:rows.map(r=>r.id)}}}),0);
    assert.equal((await db.listing.findUniqueOrThrow({where:{id:nonDraftId}})).titleEn,'Non-draft fixture');
    console.log('PASS: '+mode+' Neon ownership, genuine NULLs, bilingual fields, unchanged non-draft, soft deletion and absent payment/publication data.');
    stage=mode+' cleanup';
   },config);
   console.log('PASS: '+mode+' fixture cleanup and existing provider/auth identity preservation.');
  }
 });
}
main().catch(()=>{console.error(JSON.stringify({stage,...(httpStatus===undefined?{}:{status:httpStatus}),code:'LISTING_MANUAL_VERIFICATION_FAILED',reason:'Safe assertion or local command failed'}));process.exitCode=1;});
