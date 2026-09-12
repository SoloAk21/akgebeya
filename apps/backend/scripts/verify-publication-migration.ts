import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDatabaseClient} from '../src/database.js';
import {loadConfig} from '../src/config.js';
let stage='configuration';
async function main(){
 if(loadConfig().nodeEnv==='production')throw new Error('Development only');
 const db=createDatabaseClient();
 try{
  const tables=await db.$queryRaw<{schemaname:string;tablename:string}[]>`SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','akgebeya') AND tablename<>'_prisma_migrations' ORDER BY 1,2`;

  async function snapshot(){const result=[];for(const t of tables){
   const name='"'+t.schemaname.replaceAll('"','""')+'"."'+t.tablename.replaceAll('"','""')+'"';
   const expression='to_jsonb(t)';
   const rows=await db.$queryRawUnsafe<{data:string}[]>(`SELECT COALESCE(jsonb_agg(${expression} ORDER BY (${expression})::text)::text,'[]') AS data FROM ${name} t`);
   result.push(createHash('sha256').update(rows[0]!.data).digest('hex'));
  }return result;}
  stage='preservation snapshot';const before=await snapshot();
  const indexes=await db.$queryRaw<{indexname:string;indexdef:string}[]>`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='akgebeya' ORDER BY indexname`;
  const constraints=await db.$queryRaw<{conname:string;definition:string}[]>`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='akgebeya'::regnamespace AND conname NOT IN ('listings_draft_publication_check','listings_ai_assist_content_check','payments_initialization_check') ORDER BY conname`;
  stage='migration preservation';
  const applied=await db.$queryRawUnsafe<{migration_name:string;checksum:string}[]>('SELECT migration_name,checksum FROM akgebeya._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL');
  const {readFileSync}=await import('node:fs');
  for(const old of applied)assert.equal(createHash('sha256').update(readFileSync(fileURLToPath(new URL('../prisma/migrations/'+old.migration_name+'/migration.sql',import.meta.url)))).digest('hex'),old.checksum,'Applied migration changed');
  stage='migration apply';const child=spawnSync(process.execPath,[fileURLToPath(new URL('../../../node_modules/prisma/build/index.js',import.meta.url)),'migrate','deploy'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:process.env,windowsHide:true,encoding:'utf8',timeout:180000});
  assert.equal(child.status,0,'Migration apply failed');
  stage='record preservation';assert.deepEqual(await snapshot(),before);
  stage='catalog preservation';const afterIndexes=await db.$queryRaw<{indexname:string;indexdef:string}[]>`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='akgebeya'`;
  for(const old of indexes)assert.deepEqual(afterIndexes.find(x=>x.indexname===old.indexname),old);
  const afterConstraints=await db.$queryRaw<{conname:string;definition:string}[]>`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='akgebeya'::regnamespace`;
  for(const old of constraints)assert.deepEqual(afterConstraints.find(x=>x.conname===old.conname),old);
  stage='new schema';const labels=await db.$queryRaw<{enumlabel:string}[]>`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typnamespace='akgebeya'::regnamespace AND t.typname='ListingStatus'`;
  assert.deepEqual(labels.map(x=>x.enumlabel).sort(),['VERIFY_PAYMENT','DRAFT','COMPLETE','VALIDATE','AI_ASSIST','PREVIEW','CALCULATE_FEE','PAYMENT','PUBLISHED','PAUSED','ARCHIVED'].sort());
  for(const name of ['payments_initialization_check','listings_payment_required','payments_listing_state'])assert.ok(afterConstraints.some(c=>c.conname===name));
  assert.ok(afterIndexes.some(i=>i.indexname==='payments_feeQuoteId_key'));
  console.log('PASS: migration; existing data, indexes and constraints preserved; payment schema verified.');
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error(JSON.stringify({stage,code:'VERIFICATION_PUBLICATION_MIGRATION_FAILED'}));process.exitCode=1;});
