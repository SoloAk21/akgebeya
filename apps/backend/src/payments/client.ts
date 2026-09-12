import {z} from 'zod';
export interface ChapaInput {amountMinor:bigint;currency:'ETB';txRef:string}
export interface ChapaClient {initialize(input:ChapaInput):Promise<{checkoutUrl:string}>}
export class ChapaFailure extends Error {
 constructor(readonly outcome:'REJECTED'|'UNKNOWN'){super('Payment initialization failed');}
}
export const checkoutSchema=z.string().max(2048).url().refine(value=>{
 const u=new URL(value);return u.protocol==='https:'&&u.hostname==='checkout.chapa.co'&&!u.port&&!u.username&&!u.password&&!u.hash&&u.pathname.startsWith('/checkout/');
});
export function minorToMajor(amount:bigint):string {
 if(amount<=0n)throw new Error('Invalid payment amount');
 return (amount/100n).toString()+'.'+(amount%100n).toString().padStart(2,'0');
}
