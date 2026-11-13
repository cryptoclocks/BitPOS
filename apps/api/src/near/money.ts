// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Exact conversion between BitPOS catalog minor units and token units (6 decimals). Never floating point.
export const TOKEN_DECIMALS=6;
/** One bill is capped at 100,000 tokens in this edition. */
export const MAX_UNITS=100_000_000_000n;

/** Catalog minor units (2 or 4 decimals in BitPOS USD catalogs) → token units, or null when not exactly representable. */
export function toUnits(amountMinor:bigint|string,decimals:number):bigint|null{
 if(!Number.isInteger(decimals)||decimals<0||decimals>TOKEN_DECIMALS)return null;
 let v:bigint;try{v=BigInt(amountMinor);}catch{return null;}
 const units=v*10n**BigInt(TOKEN_DECIMALS-decimals);
 return units>0n&&units<=MAX_UNITS?units:null;
}
/** Token units → display string with at least two decimals: 5000000 → "5.00", 3825000 → "3.825". */
export function unitsToDisplay(units:bigint|string):string{
 const v=BigInt(units),neg=v<0n,a=neg?-v:v,unit=10n**BigInt(TOKEN_DECIMALS);
 let frac=(a%unit).toString().padStart(TOKEN_DECIMALS,'0');while(frac.length>2&&frac.endsWith('0'))frac=frac.slice(0,-1);
 return `${neg?'-':''}${a/unit}.${frac}`;
}
/** A typed amount such as "120" or "120.50" → token units, or null for anything else. */
export function displayToUnits(value:unknown):bigint|null{
 if(typeof value!=='string'||!/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(value))return null;
 const [whole,frac='']=value.split('.');const units=BigInt(whole)*10n**BigInt(TOKEN_DECIMALS)+BigInt(frac.padEnd(TOKEN_DECIMALS,'0'));
 return units>0n&&units<=MAX_UNITS?units:null;
}
