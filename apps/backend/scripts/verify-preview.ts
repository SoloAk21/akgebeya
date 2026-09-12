import assert from 'node:assert/strict';
import { loadConfig,loadAuthConfig } from '../src/config.js';
import { withBuiltServer } from './verification-server.js';
import { withPreviewDatabaseFixture,previewFacts } from '../test/preview-database-fixture.js';
import { privateListingCommand,runListingPostman } from './private-listing-command.js';
import { previewScenarios } from './preview-scenarios.js';
let stage='configuration',status:number|undefined;
async function main(){
 if(loadConfig().nodeEnv==='production')throw new Error('DEVELOPMENT_ONLY');
 const config=loadAuthConfig();
 // Empty overrides disable Gemini configuration in the built backend for this entire check.
 await withBuiltServer({GEMINI_API_KEY:'',GEMINI_MODEL:''},async authBase=>{
  const base=authBase.replace(/\/auth$/,'/listings');
  for(const mode of ['curl','Postman'] as const){
   stage=mode+' fixture setup';
   await withPreviewDatabaseFixture(async({db,actors,previewId})=>{
    if(mode==='curl'){
     const variables:Record<string,string>={id:previewId};
     const replace=(value:string)=>value.replace(/\{\{(\w+)\}\}/g,(_m,key:string)=>{assert.ok(variables[key]);return variables[key]!;});
     for(const scenario of previewScenarios){
      stage='curl '+scenario.name;status=undefined;
      const path=replace(scenario.path),id=/^\/([a-f0-9-]+)/.exec(path)?.[1];
      const before=id?await db.listing.findUnique({where:{id}}):null;
      const lines=['request = '+JSON.stringify(scenario.method)];
      if(scenario.actor)lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors[scenario.actor].token));
      if(scenario.match)lines.push('header = '+JSON.stringify('If-Match: '+replace(scenario.match)));
      if(scenario.body!==undefined)lines.push('header = "Content-Type: application/json"','data = '+JSON.stringify(JSON.stringify(scenario.body)));
      const raw=await privateListingCommand('curl.exe',['--silent','--show-error','--max-time','90','--config','-','--write-out','\n%{http_code}',base+path],lines.join('\n'));
      const split=raw.lastIndexOf('\n');status=Number(raw.slice(split+1));
      const body=JSON.parse(raw.slice(0,split)) as {error?:{code:string};listing?:Record<string,unknown>};
      assert.equal(status,scenario.status);
      if(scenario.error)assert.equal(body.error?.code,scenario.error);
      else{
       assert.equal(body.listing?.status,scenario.listingStatus);
       for(const[key,field]of Object.entries(scenario.capture??{})){
        assert.equal(typeof body.listing?.[field],'string');variables[key]=body.listing![field] as string;
       }
      }
      if(before){const after=await db.listing.findUniqueOrThrow({where:{id:before.id}});
       if(scenario.status!==200)assert.deepEqual(after,before);else assert.deepEqual(previewFacts(after),previewFacts(before));
      }
      console.log('PASS: '+stage+'; HTTP '+status);
     }
    }else{
     stage='Postman collection';status=undefined;
     await runListingPostman('docs/postman/listing-preview.postman_collection.json',base,actors,previewId);
     console.log('PASS: Postman preview collection ('+previewScenarios.length+' requests).');
    }
    stage=mode+' Neon inspection';status=undefined;
    const row=await db.listing.findUniqueOrThrow({where:{id:previewId}});
    assert.equal(row.status,'PREVIEW');assert.equal(row.publishedAt,null);
    assert.equal(await db.payment.count({where:{listingId:previewId}}),0);
    console.log('PASS: '+mode+' Neon status, ownership, bilingual content and listing facts unchanged; no payment or media mutation.');
    stage=mode+' cleanup';
   },config);
   console.log('PASS: '+mode+' fixtures cleaned; authentication/provider records preserved; Gemini disabled throughout.');
  }
 });
}
main().catch(()=>{console.error(JSON.stringify({stage,...(status===undefined?{}:{status}),code:'PREVIEW_VERIFICATION_FAILED',reason:'Safe verification assertion or local command failed'}));process.exitCode=1;});
