// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Cross-chain PREVIEW through NEAR Intents (1Click API). NEAR Intents has no testnet, so nothing here moves money:
// every request is a dry quote (`dry:true`), which creates no deposit address. The page shows the result labelled
// "Mainnet preview · not executed". No shop, customer or order identity is sent: the recipient and refund addresses
// are random, never-used placeholders, and only the amount and the asset pair leave this server.
import {randomBytes} from 'node:crypto';
import bs58 from 'bs58';
import {unitsToDisplay} from './money';

export const ONE_CLICK='https://1click.chaindefuser.com/v0/quote';
const NEAR_USDC='nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
type Kind='evm'|'sol';
export const ORIGINS=[
 {id:'base-usdc',chain:'Base',symbol:'USDC',asset:'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',kind:'evm' as Kind},
 {id:'sol-usdc',chain:'Solana',symbol:'USDC',asset:'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',kind:'sol' as Kind},
 {id:'arb-usdc',chain:'Arbitrum',symbol:'USDC',asset:'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',kind:'evm' as Kind},
 {id:'eth-usdc',chain:'Ethereum',symbol:'USDC',asset:'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',kind:'evm' as Kind},
 {id:'sol-usdt',chain:'Solana',symbol:'USDT',asset:'nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near',kind:'sol' as Kind}
] as const;
export interface PreviewQuote {id:string;chain:string;symbol:string;amountIn:string|null;amountOut:string|null;seconds:number|null;issue:string|null}
export interface Preview {label:'Mainnet preview · not executed';network:'mainnet';direction:'pay-in'|'send-home';amount:string;quotes:PreviewQuote[];quotedAt:string}
type Fetch=(url:string,init:{method:string;headers:Record<string,string>;body:string;signal:AbortSignal})=>Promise<{ok:boolean;status:number;json():Promise<unknown>}>;
let fetcher:Fetch=(url,init)=>fetch(url,init);
/** Tests replace the network call; production uses fetch. */
export function setIntentsFetch(f:Fetch|null){fetcher=f??((url,init)=>fetch(url,init));cache.clear();}
export const intentsEnabled=(env:NodeJS.ProcessEnv=process.env)=>env.NEAR_INTENTS_PREVIEW==='1';

const placeholder=(kind:Kind|'near')=>kind==='evm'?'0x'+randomBytes(20).toString('hex'):kind==='sol'?bs58.encode(randomBytes(32)):randomBytes(32).toString('hex');
const decimal=(value:unknown)=>typeof value==='string'&&/^\d{1,12}(\.\d{1,18})?$/.test(value)?value:null;
const cache=new Map<string,{at:number;value:Preview}>();

async function one(direction:Preview['direction'],origin:typeof ORIGINS[number],units:bigint):Promise<PreviewQuote>{
 const base={id:origin.id,chain:origin.chain,symbol:origin.symbol};
 // pay-in: the customer holds the other asset and the shop must receive exactly `units` of USDC on NEAR.
 // send-home: a staff member sends exactly `units` of USDC from NEAR and receives the other asset.
 const body=direction==='pay-in'
  ?{dry:true,swapType:'EXACT_OUTPUT',slippageTolerance:100,originAsset:origin.asset,depositType:'ORIGIN_CHAIN',destinationAsset:NEAR_USDC,amount:units.toString(),recipient:placeholder('near'),recipientType:'DESTINATION_CHAIN',refundTo:placeholder(origin.kind),refundType:'ORIGIN_CHAIN'}
  :{dry:true,swapType:'EXACT_INPUT',slippageTolerance:100,originAsset:NEAR_USDC,depositType:'ORIGIN_CHAIN',destinationAsset:origin.asset,amount:units.toString(),recipient:placeholder(origin.kind),recipientType:'DESTINATION_CHAIN',refundTo:placeholder('near'),refundType:'ORIGIN_CHAIN'};
 try{
  const response=await fetcher(ONE_CLICK,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,deadline:new Date(Date.now()+30*60_000).toISOString()}),signal:AbortSignal.timeout(8000)});
  const data=await response.json() as {quote?:Record<string,unknown>;message?:unknown};
  if(!response.ok||!data.quote)return {...base,amountIn:null,amountOut:null,seconds:null,issue:String(data.message??'QUOTE_UNAVAILABLE').slice(0,120)};
  const seconds=Number(data.quote.timeEstimate);
  return {...base,amountIn:decimal(data.quote.amountInFormatted),amountOut:decimal(data.quote.amountOutFormatted),seconds:Number.isFinite(seconds)&&seconds>=0&&seconds<86400?Math.round(seconds):null,issue:null};
 }catch{return {...base,amountIn:null,amountOut:null,seconds:null,issue:'QUOTE_UNAVAILABLE'};}
}

/** Dry quotes for one amount, cached for a minute per amount and direction. Never throws. */
export async function intentsPreview(direction:Preview['direction'],units:bigint):Promise<Preview>{
 const key=direction+':'+units;const hit=cache.get(key);if(hit&&Date.now()-hit.at<60_000)return hit.value;
 const quotes=await Promise.all(ORIGINS.map(origin=>one(direction,origin,units)));
 const value:Preview={label:'Mainnet preview · not executed',network:'mainnet',direction,amount:unitsToDisplay(units),quotes,quotedAt:new Date().toISOString()};
 if(cache.size>200)cache.clear();
 cache.set(key,{at:Date.now(),value});return value;
}
