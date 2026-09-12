import {z} from 'zod';
export const verifiedTransaction=z.object({
 status:z.enum(['success','pending','failed']),
 txRef:z.string().min(1).max(128),
 amountMinor:z.bigint().positive(),
 currency:z.string().min(1).max(8),
}).strict();
export type VerifiedTransaction=z.infer<typeof verifiedTransaction>;
export interface ChapaVerificationClient {verify(txRef:string):Promise<VerifiedTransaction>}
export class ChapaVerificationFailure extends Error {
 constructor(){super('Payment verification is unavailable');}
}
// Decimal text only: no multiplication of JavaScript floating-point numbers.
export function majorToMinor(value:string|number):bigint {
 if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<=0))throw new ChapaVerificationFailure();
 const text=String(value);
 if(!/^[0-9]{1,16}(\.[0-9]{1,2})?$/.test(text))throw new ChapaVerificationFailure();
 const [whole,fraction='']=text.split('.');
 const amount=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));
 if(amount<=0n)throw new ChapaVerificationFailure();
 return amount;
}
