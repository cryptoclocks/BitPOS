import type {Money,Settlement,CartItem} from '../../contracts/src/index';
import {MINT,TOKEN_PROGRAM,DEVNET_GENESIS,canonicalItems} from './index';
export function money(currency:'THB'|'USD'|'USDG',amount:bigint|string):Money{return currency==='USDG'?{currency,decimals:6,amountMinor:String(amount)}:{currency,decimals:2,amountMinor:String(amount)};}
export function settlement(currency:'USD'|'USDG',total:bigint,recipient:string):Settlement {const raw=currency==='USD'?total*10000n:total;if(raw<=0n||raw>999999999999999999n)throw Error('Invalid settlement amount');return {currency:'USDG',decimals:6,amountMinor:String(raw),network:'solana:devnet',genesisHash:DEVNET_GENESIS,mint:MINT,tokenProgram:TOKEN_PROGRAM,testToken:true,recipient,sponsor:'merchant_funded'};}
export function draftItems(items:CartItem[]){return items.length?canonicalItems(items):[];}
export function safeRelease(status:string,reservationReleased:boolean,ambiguous:number,rendered:boolean,recoveryResolved:boolean){return status==='PAID'?rendered&&ambiguous===0:status==='EXPIRED'?reservationReleased&&ambiguous===0:status==='RECOVERY'?recoveryResolved&&ambiguous===0:false;}
