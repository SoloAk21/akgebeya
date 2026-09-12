import type {AuthConfig} from '../src/config.js';
import {withPreviewDatabaseFixture} from './preview-database-fixture.js';
type Fixture=Parameters<Parameters<typeof withPreviewDatabaseFixture>[0]>[0];
export async function withFeeDatabaseFixture(run:(f:Fixture&{sourceRevision:string})=>Promise<void>,config?:AuthConfig){
 await withPreviewDatabaseFixture(async f=>{
  const preview=await f.listings.preview(f.actors.owner.context,f.previewId,(await f.listings.get(f.actors.owner.context,f.previewId)).etag);
  await run({...f,sourceRevision:preview.etag});
 },config);
}
