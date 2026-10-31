// PayPal AI Hackathon work (2026-10-31..11-12). See paypal-hackathon/PROVENANCE.md.
// Exact conversion between BitPOS catalog minor units and PayPal USD strings. Never floating point.

/** PayPal USD amounts have exactly two decimals; cap one order at USD 10,000.00 for the sandbox edition. */
export const PAYPAL_MAX_CENTS=1_000_000n;
const VALUE=/^(0|[1-9]\d{0,6})\.\d{2}$/;

/** Catalog minor units (2 or 4 decimals in BitPOS USD catalogs) → USD cents, or null when not exactly representable. */
export function toCents(amountMinor:bigint|string,decimals:number):bigint|null{
 if(!Number.isInteger(decimals)||decimals<0||decimals>18)return null;
 let v:bigint;try{v=BigInt(amountMinor);}catch{return null;}
 const cents=decimals<=2?v*10n**BigInt(2-decimals):v%10n**BigInt(decimals-2)===0n?v/10n**BigInt(decimals-2):null;
 return cents!==null&&cents>0n&&cents<=PAYPAL_MAX_CENTS?cents:null;
}
/** USD cents → PayPal `value` string ("4.50"). */
export function centsToValue(cents:bigint):string{
 if(cents<=0n||cents>PAYPAL_MAX_CENTS)throw new RangeError('PAYPAL_AMOUNT_OUT_OF_RANGE');
 return `${cents/100n}.${(cents%100n).toString().padStart(2,'0')}`;
}
/** Catalog minor units → PayPal `value`, or null when the price cannot be charged exactly. */
export function toPayPalValue(amountMinor:bigint|string,decimals:number):string|null{const c=toCents(amountMinor,decimals);return c===null?null:centsToValue(c);}
/** PayPal `value` string → cents, or null for anything that is not a plain two-decimal amount. */
export function valueToCents(value:unknown):bigint|null{
 if(typeof value!=='string'||!VALUE.test(value))return null;
 const [whole,frac]=value.split('.');return BigInt(whole)*100n+BigInt(frac);
}
