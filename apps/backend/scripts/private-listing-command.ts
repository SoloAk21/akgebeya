import { spawn } from 'node:child_process';
import { randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { readFile,writeFile,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { withServer } from '../test/helpers.js';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export async function privateListingCommand(executable:string,args:string[],input=''){
 return new Promise<string>((resolve,reject)=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC|PROGRAMFILES|PROGRAMFILES\(X86\))$/i.test(k)));
  const child=spawn(executable,args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';
  child.stdout.on('data',part=>{output+=String(part);});child.stderr.on('data',()=>{});
  child.once('error',()=>reject(new Error('LOCAL_COMMAND_FAILED')));
  child.once('close',code=>code===0?resolve(output):reject(new Error('LOCAL_COMMAND_FAILED')));
  child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
export async function runListingPostman(collectionFile:string,base:string,actors:Record<string,{token:string}>,nonDraftId:string){
     const key=randomBytes(32).toString('base64url'),fixture=express();
     fixture.post('/credentials',(req,res)=>{
      const actual=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+key);res.set('Cache-Control','no-store');
      if(req.headers.origin||actual.length!==expected.length||!timingSafeEqual(actual,expected)){res.sendStatus(403);return;}
      res.json({tokens:Object.fromEntries(Object.entries(actors).map(([name,a])=>[name,a.token])),nonDraftId});
     });
     await withServer(fixture,async fixtureUrl=>{
      const collection=JSON.parse(await readFile(root+collectionFile,'utf8')) as {variable:{key:string;value:string}[]};
      collection.variable=[{key:'baseUrl',value:base},{key:'fixtureUrl',value:fixtureUrl},{key:'fixtureKey',value:key}];
      const temporary=root+'.git/listing-manual-'+randomUUID()+'.json';
      try{await writeFile(temporary,JSON.stringify(collection),{flag:'wx'});
       await privateListingCommand(process.execPath,[root+'node_modules/postman-cli/bin/postman.js','collection','run',temporary,'--no-report-events','--silent']);
      }finally{await unlink(temporary);}
     });
}
