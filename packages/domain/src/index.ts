import { createHash } from 'node:crypto';
export const MINT='4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7';
export const TOKEN_PROGRAM='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const DEVNET_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function quote(thbMinor:bigint){if(thbMinor<=0n)throw Error('Invalid quote');return (thbMinor*1000000n+1750n)/3500n;}
export function assertSettlement(input:{error:unknown;mint:string;program:string;recipient:string;rawAmount:bigint;reference:string;payer:string},expected:{mint:string;program:string;recipient:string;rawAmount:bigint;reference:string;payer:string}){
 if(input.error)throw Error('Transaction failed');
 for(const key of ['mint','program','recipient','reference','payer'] as const)if(input[key]!==expected[key])throw Error(`Wrong ${key}`);
 if(input.rawAmount!==expected.rawAmount)throw Error('Wrong amount');
}
