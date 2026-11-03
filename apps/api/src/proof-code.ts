import {randomInt} from 'node:crypto';

// Crockford base32 without U: no 0/O or 1/I/L confusion when a rider types it from a phone screen.
const ALPHABET='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PROOF_CODE_LENGTH=10;

/** A 10-character one-time code (50 bits). It is only accepted a few times and only for minutes, so it is enough for a pickup/delivery handoff. */
export function newProofSecret():string{
 let out='';
 for(let i=0;i<PROOF_CODE_LENGTH;i++)out+=ALPHABET[randomInt(ALPHABET.length)];
 return out;
}

/** Short codes are typed by people: ignore case, spaces and hyphens and read the look-alike letters the way the alphabet does. Long legacy tokens are case-sensitive and stay untouched. */
export function normalizeProofSecret(input:string):string{
 const stripped=input.replace(/[\s-]+/g,'');
 if(stripped.length>16)return input;
 return stripped.toUpperCase().replace(/O/g,'0').replace(/[IL]/g,'1');
}
