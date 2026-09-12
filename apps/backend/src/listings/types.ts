import type { ListingAiOutput } from './ai.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { ProviderRecord } from '../providers/types.js';
import type { DraftInput } from './input.js';
export type ListingRow=Prisma.ListingGetPayload<{include:{location:true;_count:{select:{payments:true;media:true}}}}>;
export type DraftRecord=ListingRow & { revision:string };
export interface DraftStore {
 provider:ProviderRecord|null;
 create(input:DraftInput):Promise<DraftRecord>;
 get(id:string,lock?:boolean):Promise<DraftRecord|null>;
 transition(current:DraftRecord,target:'COMPLETE'|'VALIDATE'):Promise<DraftRecord>;
 saveAi(current:DraftRecord,output:ListingAiOutput):Promise<DraftRecord>;
 mine(limit:number,offset:number):Promise<DraftRecord[]>;
 update(current:DraftRecord,input:DraftInput,remove:boolean):Promise<DraftRecord>;
}
export interface ListingRepository {
 withProvider<T>(userId:string,run:(store:DraftStore)=>Promise<T>):Promise<T>;
}
