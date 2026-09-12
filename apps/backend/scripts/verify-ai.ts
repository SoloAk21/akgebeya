import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadAuthConfig, loadGeminiConfig } from '../src/config.js';
import { withBuiltServer } from './verification-server.js';
import { withListingDatabaseFixture } from '../test/listing-database-fixture.js';
import { privateListingCommand, runListingPostman } from './private-listing-command.js';
import { aiScenarios } from './ai-scenarios.js';
import { parseAiOutput } from '../src/listings/ai.js';
import { ListingService } from '../src/listings/service.js';
import { PrismaListingRepository } from '../src/listings/repository.js';
import { HttpError } from '../src/errors.js';
import { createApp } from '../src/app.js';
import { withServer } from '../test/helpers.js';
import { completeInput } from '../test/completion-fixture.js';

let stage='configuration',httpStatus:number|undefined,code='AI_MANUAL_VERIFICATION_FAILED';
const root=fileURLToPath(new URL('../../../',import.meta.url));
function facts<T extends {titleEn:unknown;titleAm:unknown;descriptionEn:unknown;descriptionAm:unknown;status:unknown;updatedAt:unknown}>(row:T){
 const {titleEn:_a,titleAm:_b,descriptionEn:_c,descriptionAm:_d,status:_s,updatedAt:_u,...rest}=row;return rest;
}
async function main(){
 const appConfig=loadConfig();
 if(appConfig.nodeEnv==='production')throw new Error('DEVELOPMENT_ONLY');
 const config=loadAuthConfig(),gemini=loadGeminiConfig();
 if(!gemini.apiKey||!gemini.model)throw new Error('GEMINI_CONFIGURATION_REQUIRED');
 const args=process.argv.slice(2);
 if(args.some(arg=>!['--curl','--postman','--review'].includes(arg)))throw new Error('INVALID_ARGUMENTS');
 const modes=args.includes('--curl')?['curl'] as const:args.includes('--postman')?['Postman'] as const:['curl','Postman'] as const;
 await withBuiltServer({},async authBase=>{
  const base=authBase.replace(/\/auth$/,'/listings');
  for(const mode of modes){
   stage=mode+' fixture setup';
   await withListingDatabaseFixture(async({db,actors,providerIds,nonDraftId,auth,service,listings})=>{
    if(mode==='curl'){
     const variables:Record<string,string>={};
     const replace=(value:string)=>value.replace(/\{\{(\w+)\}\}/g,(_m,key:string)=>{assert.ok(variables[key]);return variables[key]!;});
     for(const scenario of aiScenarios){
      stage='curl '+scenario.name;httpStatus=undefined;code='AI_MANUAL_VERIFICATION_FAILED';
      const path=replace(scenario.path),id=/^\/([a-f0-9-]+)/.exec(path)?.[1];
      const before=id?await db.listing.findUnique({where:{id}}):null;
      const lines=['request = '+JSON.stringify(scenario.method)];
      if(scenario.actor)lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors[scenario.actor].token));
      if(scenario.match)lines.push('header = '+JSON.stringify('If-Match: '+replace(scenario.match)));
      if(scenario.body!==undefined)lines.push('header = "Content-Type: application/json"','data = '+JSON.stringify(JSON.stringify(scenario.body)));
      const raw=await privateListingCommand('curl.exe',['--silent','--show-error','--max-time','90','--config','-','--write-out','\n%{http_code}',base+path],lines.join('\n'));
      const split=raw.lastIndexOf('\n');httpStatus=Number(raw.slice(split+1));
      const body=JSON.parse(raw.slice(0,split)) as {error?:{code:string};listing?:Record<string,unknown>};
      if(body.error&&/^AI_(UNAVAILABLE|TIMEOUT|RATE_LIMITED|OUTPUT_INVALID)$/.test(body.error.code))code=body.error.code;
      assert.equal(httpStatus,scenario.status);
      if(scenario.error)assert.equal(body.error?.code,scenario.error);
      else{
       assert.equal(body.listing?.status,scenario.listingStatus);
       for(const[key,field]of Object.entries(scenario.capture??{})){
        assert.equal(typeof body.listing?.[field],'string');variables[key]=body.listing![field] as string;
       }
      }
      if(before){
       const after=await db.listing.findUniqueOrThrow({where:{id:before.id}});
       if(scenario.status!==200)assert.deepEqual(after,before);
       else if(path.endsWith('/ai-assist'))assert.deepEqual(facts(after),facts(before));
      }
      console.log('PASS: '+stage+'; HTTP '+httpStatus);
     }
    }else{
     stage='Postman collection';httpStatus=undefined;
     await runListingPostman('docs/postman/listing-ai-assist.postman_collection.json',base,actors,nonDraftId);
     console.log('PASS: Postman AI collection ('+aiScenarios.length+' requests).');
    }
    stage=mode+' Neon inspection';
    const rows=await db.listing.findMany({where:{providerId:{in:providerIds},status:'AI_ASSIST'},include:{location:true}});
    assert.equal(rows.length,1);const row=rows[0]!;
    assert.equal(row.providerId,(await db.provider.findUniqueOrThrow({where:{userId:actors.owner.id}})).id);
    assert.equal(row.category,'RESIDENTIAL');assert.equal(row.type,'SALE');assert.equal(row.propertyType,'HOUSE');
    assert.equal(row.price?.toFixed(2),'100.00');assert.equal(row.bedrooms,2);assert.equal(row.bathrooms,1);assert.equal(row.areaSqm?.toFixed(2),'80.00');
    assert.equal(row.location?.cityEn,'Addis Ababa');assert.equal(row.location?.regionEn,'Addis Ababa');
    assert.equal(row.publishedAt,null);assert.equal(row.deletedAt,null);
    const copy=parseAiOutput(JSON.stringify({titleEn:row.titleEn,titleAm:row.titleAm,descriptionEn:row.descriptionEn,descriptionAm:row.descriptionAm}));
    if(args.includes('--review')){
     // Only rendered application copy for synthetic fixtures, never API envelopes or credentials.
     await writeFile(root+'.git/ai-review-'+mode.toLowerCase()+'.txt',
      'Synthetic fixture: HOUSE SALE, Addis Ababa, 100.00 ETB, 2 bedrooms, 1 bathroom, 80.00 sqm.\n\n'+
      Object.entries(copy).map(([field,text])=>field+'\n'+text).join('\n\n'),{encoding:'utf8'});
    }
    stage=mode+' numerical content checks';
    for(const value of Object.values(copy)){
     assert.ok(!/[`{}<>]/.test(value));
     for(const number of value.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)??[])
      assert.ok([1,2,80,100].includes(Number(number.replaceAll(',',''))),'Generated numerical fact was not supplied');
    }
    assert.equal(await db.payment.count({where:{listingId:row.id}}),0);
    assert.equal(await db.media.count({where:{listingId:row.id}}),0);
    console.log('PASS: '+mode+' real Gemini; bilingual fields, stored facts, unpublished state and no payment/media.');

    stage=mode+' safe failure simulation';
    const draft=await listings.create(actors.owner.context,completeInput());
    const complete=await listings.transition(actors.owner.context,draft.id,'COMPLETE',draft.etag);
    const validated=await listings.transition(actors.owner.context,draft.id,'VALIDATE',complete.etag);
    const before=await db.listing.findUniqueOrThrow({where:{id:draft.id}});
    for(const failure of ['malformed','unavailable'] as const){
     const client={async generate(){if(failure==='unavailable')throw new HttpError('AI_UNAVAILABLE');return 'invalid';}};
     const testListings=new ListingService(new PrismaListingRepository(db),client);
     await withServer(createApp(appConfig,auth,undefined,undefined,undefined,service,testListings),async local=>{
      const input=['request = "POST"','header = '+JSON.stringify('Authorization: Bearer '+actors.owner.token),'header = '+JSON.stringify('If-Match: '+validated.etag)].join('\n');
      const raw=await privateListingCommand('curl.exe',['--silent','--show-error','--config','-','--write-out','\n%{http_code}',local+'/api/v1/listings/'+draft.id+'/ai-assist'],input);
      const split=raw.lastIndexOf('\n');assert.equal(Number(raw.slice(split+1)),failure==='malformed'?502:503);
      assert.deepEqual(await db.listing.findUniqueOrThrow({where:{id:draft.id}}),before);
     });
    }
    console.log('PASS: '+mode+' controlled failure simulation, no content/state mutation.');
    stage=mode+' cleanup';
   },config);
   console.log('PASS: '+mode+' temporary records removed; authentication/provider data preserved.');
  }
 });
}
main().catch(()=>{console.error(JSON.stringify({stage,...(httpStatus===undefined?{}:{status:httpStatus}),code,reason:'Safe verification assertion or local command failed'}));process.exitCode=1;});
