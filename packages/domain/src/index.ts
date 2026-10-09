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
export const avatar=(address:string)=>`wallet-${hash(address).slice(0,12)}`;
export function liveOrder(order:{status:string;quote_expires_at:string|Date},now=Date.now()){
 if(!['AWAITING_WALLET','AWAITING_PAYMENT'].includes(order.status)||new Date(order.quote_expires_at).getTime()<=now)throw Error('Order is not payable');
}
export function challengeMessage(input:{nonce:string;address:string;orderId:string;merchantId:string;domain:string;expiresAt:string}){
 return ['BitPOS wallet binding',`Domain: ${input.domain}`,'Chain: solana:devnet',`Merchant: ${input.merchantId}`,`Order: ${input.orderId}`,`Address: ${input.address}`,`Nonce: ${input.nonce}`,`Expires: ${input.expiresAt}`].join('\n');
}
export function canonicalItems(items:{productId:string;qty:number}[]){
 if(!items.length||items.length>50)throw Error('Invalid items');
 const totals=new Map<string,number>();
 for(const item of items){if(!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>100)throw Error('Invalid quantity');totals.set(item.productId,(totals.get(item.productId)??0)+item.qty);}
 return [...totals].sort(([a],[b])=>a.localeCompare(b)).map(([productId,qty])=>{if(qty>100)throw Error('Invalid quantity');return {productId,qty};});
}
export function deviceBillLines(items:{name:string;qty:number}[]){
 const lines=items.slice(0,items.length>6?5:6).map(item=>{
  const value=`${item.qty} x ${item.name}`;let line='',bytes=0;
  for(const character of value){const size=Buffer.byteLength(character);if(bytes+size>90)break;line+=character;bytes+=size;}
  return line===value?line:line+'...';
 });
 if(items.length>6)lines.push(`+ ${items.length-5} more items`);
 return lines;
}
