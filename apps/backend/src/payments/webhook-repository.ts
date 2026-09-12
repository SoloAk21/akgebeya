import type {PrismaClient} from '../generated/prisma/client.js';
export interface WebhookPaymentBinding {id:string;userId:string;listingId:string;gatewayReference:string}
export interface PaymentWebhookRepository {findByReference(reference:string):Promise<WebhookPaymentBinding|null>}
export class PrismaPaymentWebhookRepository implements PaymentWebhookRepository {
 constructor(private readonly db:PrismaClient){}
 async findByReference(reference:string):Promise<WebhookPaymentBinding|null>{
  const payment=await this.db.payment.findUnique({where:{gateway_gatewayReference:{gateway:'CHAPA',gatewayReference:reference}},select:{id:true,userId:true,listingId:true,gatewayReference:true,feeQuoteId:true}});
  if(!payment?.feeQuoteId||!payment.listingId||!payment.gatewayReference)return null;
  return {id:payment.id,userId:payment.userId,listingId:payment.listingId,gatewayReference:payment.gatewayReference};
 }
}
