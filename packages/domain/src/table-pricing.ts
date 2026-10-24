import type {Money,Settlement,CartItem} from '../../contracts/src/index';
import {MINT,TOKEN_PROGRAM,DEVNET_GENESIS,canonicalItems} from './index';
export function money(currency:Money['currency'],amount:bigint|string,decimals:2|4|6=currency==='USD'||currency==='THB'?2:6):Money {
 if(currency==='USD'&&(decimals===2||decimals===4))return {currency,decimals,amountMinor:String(amount)};
 if(currency==='THB'&&decimals===2)return {currency,decimals,amountMinor:String(amount)};
 if((currency==='USDG'||currency==='USDC'||currency==='USDT')&&decimals===6)return {currency,decimals,amountMinor:String(amount)};
 throw Error('Invalid currency precision');
}
export function settlement(currency:'USD'|'USDG',total:bigint,recipient:string,decimals:number=currency==='USD'?2:6):Settlement {
 if(currency==='USD'&&decimals!==2&&decimals!==4||currency==='USDG'&&decimals!==6)throw Error('Invalid currency precision');
 const raw=currency==='USD'?total*10n**BigInt(6-decimals):total;
 if(raw<=0n||raw>999999999999999999n)throw Error('Invalid settlement amount');
 return {currency:'USDG',decimals:6,amountMinor:String(raw),network:'solana:devnet',genesisHash:DEVNET_GENESIS,mint:MINT,tokenProgram:TOKEN_PROGRAM,testToken:true,recipient,sponsor:'merchant_funded'};
}
export function draftItems(items:CartItem[]){return items.length?canonicalItems(items):[];}
export function safeRelease(status:string,reservationReleased:boolean,ambiguous:number,rendered:boolean,recoveryResolved:boolean){return status==='PAID'?rendered&&ambiguous===0:status==='EXPIRED'?reservationReleased&&ambiguous===0:status==='RECOVERY'?recoveryResolved&&ambiguous===0:false;}
