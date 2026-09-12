import assert from 'node:assert/strict';
import { loadConfig,loadAuthConfig } from '../src/config.js';
import { withBuiltServer } from './verification-server.js';
import { withListingDatabaseFixture } from '../test/listing-database-fixture.js';
import { privateListingCommand,runListingPostman } from './private-listing-command.js';
import { completionScenarios } from './completion-scenarios.js';
let stage='configuration',httpStatus:number|undefined;
async function main(){
 if(loadConfig().nodeEnv==='production')throw new Error('DEVELOPMENT_ONLY');
 const config=loadAuthConfig();
 await withBuiltServer({},async authBase=>{
  const base=authBase.replace(/\/auth$/,'/listings');
  for(const mode of ['curl','Postman'] as const){
   await withListingDatabaseFixture(async({db,actors,providerIds,nonDraftId})=>{
    if(mode==='curl'){
     const variables:Record<string,string>={};
     const replace=(value:string)=>value.replace(/\{\{(\w+)\}\}/g,(_m,key:string)=>{assert.ok(variables[key]);return variables[key]!;});
     for(const scenario of completionScenarios){
      stage='curl '+scenario.name;httpStatus=undefined;
      const path=replace(scenario.path),id=/^\/([a-f0-9-]+)\/(complete|validate)$/.exec(path)?.[1];
      const before=id?await db.listing.findUnique({where:{id}}):null;
      const lines=['request = '+JSON.stringify(scenario.method),'header = "Content-Type: application/json"'];
      if(scenario.actor)lines.push('header = '+JSON.stringify('Authorization: Bearer '+actors[scenario.actor].token));
      if(scenario.match)lines.push('header = '+JSON.stringify('If-Match: '+replace(scenario.match)));
      if(scenario.body!==undefined)lines.push('data = '+JSON.stringify(JSON.stringify(scenario.body)));
      const result=await privateListingCommand('curl.exe',['--silent','--show-error','--config','-','--write-out','\n%{http_code}',base+path],lines.join('\n'));
      const split=result.lastIndexOf('\n');httpStatus=Number(result.slice(split+1));assert.equal(httpStatus,scenario.status);
      const body=JSON.parse(result.slice(0,split)) as {error?:{code:string;fields?:string[]};listing?:Record<string,unknown>;status?:string};
      if(scenario.error){assert.equal(body.error?.code,scenario.error);if(scenario.fields)assert.deepEqual(body.error?.fields,scenario.fields);}
      else if(scenario.method==='DELETE')assert.equal(body.status,'ok');
      else{assert.equal(body.listing?.status,scenario.listingStatus);
       for(const[key,field]of Object.entries(scenario.capture??{})){const value=body.listing?.[field];assert.equal(typeof value,'string');variables[key]=value as string;}
      }
      if(before){
       const after=await db.listing.findUniqueOrThrow({where:{id:before.id}});
       if(scenario.status===200){
        const {status:_beforeStatus,updatedAt:_beforeTime,...oldContent}=before;
        const {status:_afterStatus,updatedAt:_afterTime,...newContent}=after;
        assert.deepEqual(newContent,oldContent);assert.equal(after.status,scenario.listingStatus);assert.equal(after.publishedAt,null);
       }else assert.deepEqual(after,before);
      }
     }
    }else{
     stage='Postman collection';httpStatus=undefined;
     await runListingPostman('docs/postman/listing-completion.postman_collection.json',base,actors,nonDraftId);
    }
    console.log('PASS: '+mode+' completion/validation ('+completionScenarios.length+' requests), state machine, ownership and ETags.');
    stage=mode+' Neon inspection';
    const rows=await db.listing.findMany({where:{providerId:{in:providerIds},status:{not:'PAUSED'}}});
    assert.equal(rows.length,6);assert.equal(rows.filter(r=>r.status==='VALIDATE').length,3);assert.equal(rows.filter(r=>r.status==='DRAFT').length,3);
    const provider=await db.provider.findUniqueOrThrow({where:{userId:actors.owner.id}});
    assert.ok(rows.every(r=>r.providerId===provider.id&&r.publishedAt===null&&r.titleAm===null&&r.descriptionAm===null));
    for(const row of rows.filter(r=>r.status==='VALIDATE')){
     assert.equal(row.titleEn,'Completion fixture');assert.equal(row.descriptionEn,'Private completion verification fixture');
     assert.equal(row.price?.toFixed(2),'100.00');assert.equal(row.bedrooms,null);assert.equal(row.bathrooms,null);assert.equal(row.areaSqm,null);
    }
    assert.equal(rows.filter(r=>r.deletedAt!==null).length,1);
    assert.equal(await db.payment.count({where:{listingId:{in:rows.map(r=>r.id)}}}),0);
    assert.equal(await db.media.count({where:{listingId:{in:rows.map(r=>r.id)}}}),0);
    console.log('PASS: '+mode+' Neon states, unchanged ownership/content, optional fields, no payment/media/publication.');
    stage=mode+' cleanup';
   },config);
   console.log('PASS: '+mode+' tracked fixtures cleaned; provider and authentication identities preserved.');
  }
 });
}
main().catch(()=>{console.error(JSON.stringify({stage,...(httpStatus===undefined?{}:{status:httpStatus}),code:'COMPLETION_MANUAL_VERIFICATION_FAILED',reason:'Safe assertion or local command failed'}));process.exitCode=1;});
