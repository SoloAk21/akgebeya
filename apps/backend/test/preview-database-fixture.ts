import assert from 'node:assert/strict';
import type { AuthConfig } from '../src/config.js';
import { withListingDatabaseFixture } from './listing-database-fixture.js';
import { completeInput } from './completion-fixture.js';
import { aiOutput } from './ai-fixture.js';
export function previewFacts<T extends {status:unknown;updatedAt:unknown}>(row:T){const {status:_s,updatedAt:_u,...facts}=row;return facts;}
type Fixture=Parameters<Parameters<typeof withListingDatabaseFixture>[0]>[0];
export async function withPreviewDatabaseFixture(run:(f:Fixture & {previewId:string})=>Promise<void>,config?:AuthConfig){
 await withListingDatabaseFixture(async f=>{
  const draft=await f.listings.create(f.actors.owner.context,{...completeInput(),...aiOutput});
  // Temporary stored AI_ASSIST fixture only: no Gemini call or production bypass endpoint.
  const before=await f.db.listing.update({where:{id:draft.id},data:{status:'AI_ASSIST'}});
  const payments=await f.db.payment.findMany(),media=await f.db.media.findMany();
  await run({...f,previewId:draft.id});
  const after=await f.db.listing.findUniqueOrThrow({where:{id:draft.id}});
  assert.deepEqual(previewFacts(after),previewFacts(before));
  assert.equal(after.publishedAt,null);
  assert.deepEqual(await f.db.payment.findMany(),payments);assert.deepEqual(await f.db.media.findMany(),media);
 },config);
}
