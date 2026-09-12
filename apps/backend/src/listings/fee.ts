import type { ListingFeeQuote } from '../generated/prisma/client.js';
// Approved AkGebeya V1: 500 ETB for every listing, without expiry or repricing.
export const listingFeeV1=Object.freeze({amountMinor:50000n,currency:'ETB' as const,pricingVersion:'v1'});
export function feeView(quote:Pick<ListingFeeQuote,'amountMinor'|'currency'|'pricingVersion'>){
 return {amountMinor:quote.amountMinor.toString(),currency:quote.currency,pricingVersion:quote.pricingVersion};
}
