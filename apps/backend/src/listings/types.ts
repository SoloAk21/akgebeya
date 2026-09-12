import type { PaymentNotification } from '../payments/notifications.js';
import type { ListingAiOutput } from './ai.js';
import type { Prisma,ListingFeeQuote,Payment } from '../generated/prisma/client.js';
import type { ProviderRecord } from '../providers/types.js';
import type { DraftInput } from './input.js';
export type ListingRow=Prisma.ListingGetPayload<{include:{location:true;_count:{select:{payments:true;media:true}}}}>;
export type DraftRecord=ListingRow & { revision:string };
export interface DraftStore {
 provider:ProviderRecord|null;
 findPayment(listingId:string):Promise<Payment|null>;
 reservePayment(input:Pick<Payment,'userId'|'listingId'|'feeQuoteId'|'amountMinor'|'currency'|'gatewayReference'|'idempotencyKey'|'sourceRevision'>):Promise<Payment>;
 settlePayment(id:string,status:'SUCCEEDED'|'FAILED',notification:PaymentNotification):Promise<Payment>;
 publish(current:DraftRecord):Promise<DraftRecord>;
 initializePayment(id:string,checkoutUrl:string):Promise<void>;

 create(input:DraftInput):Promise<DraftRecord>;
 get(id:string,lock?:boolean):Promise<DraftRecord|null>;
 transition(current:DraftRecord,target:'COMPLETE'|'VALIDATE'|'PREVIEW'|'CALCULATE_FEE'|'PAYMENT'|'VERIFY_PAYMENT'):Promise<DraftRecord>;
 findFeeQuote(id:string):Promise<ListingFeeQuote|null>;
 createFeeQuote(current:DraftRecord,fee:Pick<ListingFeeQuote,'amountMinor'|'currency'|'pricingVersion'>,sourceRevision:string):Promise<ListingFeeQuote>;
 saveAi(current:DraftRecord,output:ListingAiOutput):Promise<DraftRecord>;
 mine(limit:number,offset:number):Promise<DraftRecord[]>;
 update(current:DraftRecord,input:DraftInput,remove:boolean):Promise<DraftRecord>;
}
export interface ListingRepository {
 recordPaymentFailure(id:string,outcome:'REJECTED'|'UNKNOWN'):Promise<void>;
 withProvider<T>(userId:string,run:(store:DraftStore)=>Promise<T>):Promise<T>;
}
