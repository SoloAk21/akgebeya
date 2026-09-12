import assert from 'node:assert/strict';
import {loadConfig,loadAuthConfig} from '../src/config.js';
import {withBuiltServer} from './verification-server.js';
import {withFeeDatabaseFixture} from '../test/fee-database-fixture.js';
import {previewFacts} from '../test/preview-database-fixture.js';
import {privateListingCommand,runListingPostman} from './private-listing-command.js';
import {feeScenarios} from './fee-scenarios.js';
let stage='configuration',status:number|undefined;
async function main(){
 if(loadConfig().nodeEnv==='production')throw new Error('DEVELOPMENT_ONLY');
 const config=loadAuthConfig();
 await withBuiltServer({GEMINI_API_KEY:'',GEMINI_MODEL:''},async authBase=>{
  const base=authBase.replace(/\/auth$/,'/listings');
  for(const mode of ['curl','Postman'] as const){
   stage=mode+' fixture setup';
   await withFeeDatabaseFixture(async({db,actors,previewId,sourceRevision})=>{
    if(mode==='curl'){
     const variables:Record<string,string>={id:previewId};
     const replace=(value:string)=>value.replace(/\{\{(\w+)\}\}/g,(_m,key:string)=>{assert.ok(variables[key]);return variables[key]!;});
     for(const scenario of feeScenarios){
      stage='curl '+scenario.name;status=undefined;
      const path=replace(scenario.path),id=/^\/([a-f0-9-]+)/.exec(path)?.[1];
      const before=id?await db.listing.findUnique({where:{id}}):null;
      const quoteBefore=id?await db.listingFeeQuote.findUnique({where:{listingId:id}}):null;
      const lines=['request = '+JSON.stringify(scenario.method)];
      if(scenario.actor)lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors[scenario.actor].token));
      if(scenario.match)lines.push('header = '+JSON.stringify('If-Match: '+replace(scenario.match)));
      if(scenario.body!==undefined)lines.push('header = "Content-Type: application/json"','data = '+JSON.stringify(JSON.stringify(scenario.body)));
      const raw=await privateListingCommand('curl.exe',['--silent','--show-error','--max-time','90','--config','-','--write-out','\n%{http_code}',base+path],lines.join('\n'));
      const split=raw.lastIndexOf('\n');status=Number(raw.slice(split+1));
      const body=JSON.parse(raw.slice(0,split)) as {error?:{code:string};listing?:Record<string,unknown>;status?:string;fee?:unknown;etag?:string};
      assert.equal(status,scenario.status);
      if(scenario.error)assert.equal(body.error?.code,scenario.error);
      else{
       const result=body.listing??body;assert.equal(result.status,scenario.listingStatus);
       if(scenario.listingStatus==='CALCULATE_FEE')assert.deepEqual(result.fee,{amountMinor:'50000',currency:'ETB',pricingVersion:'v1'});
       for(const[key,field]of Object.entries(scenario.capture??{})){
        const value=(result as Record<string,unknown>)[field];assert.equal(typeof value,'string');variables[key]=value as string;
       }
      }
      if(before){const after=await db.listing.findUniqueOrThrow({where:{id:before.id}});
       if(scenario.status!==200)assert.deepEqual(after,before);else assert.deepEqual(previewFacts(after),previewFacts(before));
       if(!(scenario.status===200&&path.endsWith('/calculate-fee')))assert.deepEqual(await db.listingFeeQuote.findUnique({where:{listingId:before.id}}),quoteBefore);
      }
      console.log('PASS: '+stage+'; HTTP '+status);
     }
    }else{
     stage='Postman collection';status=undefined;
     await runListingPostman('docs/postman/listing-fee.postman_collection.json',base,actors,previewId);
     console.log('PASS: Postman fee collection ('+feeScenarios.length+' requests).');
    }
    stage=mode+' Neon inspection';status=undefined;
    const row=await db.listing.findUniqueOrThrow({where:{id:previewId}});
    const quotes=await db.listingFeeQuote.findMany({where:{listingId:previewId}});assert.equal(quotes.length,1);const quote=quotes[0]!;
    assert.equal(row.status,'CALCULATE_FEE');assert.equal(row.publishedAt,null);
    assert.equal(quote.amountMinor,50000n);assert.equal(quote.currency,'ETB');assert.equal(quote.pricingVersion,'v1');assert.equal(quote.sourceRevision,sourceRevision);
    assert.equal(await db.payment.count({where:{listingId:previewId}}),0);
    console.log('PASS: '+mode+' Neon: one authoritative 50000/ETB/v1 quote for source revision; preserved facts, no payment/publication.');
    stage=mode+' cleanup';
   },config);
   console.log('PASS: '+mode+' fixture cleanup; auth/provider records preserved; Gemini disabled throughout.');
  }
 });
}
main().catch(()=>{console.error(JSON.stringify({stage,...(status===undefined?{}:{status}),code:'FEE_VERIFICATION_FAILED',reason:'Safe verification assertion or local command failed'}));process.exitCode=1;});
