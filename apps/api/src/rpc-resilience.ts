import {Connection} from '@solana/web3.js';
import type {Commitment} from '@solana/web3.js';

/** The public devnet endpoint rate-limits per IP (HTTP 429). This wraps `fetch` for JSON-RPC calls with
 * - request pacing (a minimum gap between request starts and a cap on requests in flight),
 * - bounded retries with exponential backoff + jitter that honour `Retry-After`, and
 * - a total deadline so an API request never waits unboundedly.
 * Retrying is safe here: every JSON-RPC body is replayed byte for byte, reads are idempotent and a re-sent
 * signed transaction is the same transaction. After the budget is spent the last response is returned
 * unchanged, so callers keep their existing "unavailable, state retained" handling. */
export interface RpcResilienceOptions{
 maxRetries?:number;baseDelayMs?:number;maxDelayMs?:number;
 /** Per-attempt network timeout. */
 timeoutMs?:number;
 /** Stop retrying once this much time has passed since the call started. */
 deadlineMs?:number;
 minIntervalMs?:number;maxConcurrent?:number;
 fetchImpl?:typeof fetch;sleep?:(ms:number)=>Promise<void>;now?:()=>number;random?:()=>number;
}
const RETRY_STATUS=new Set([429,502,503,504]);
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function retryAfterMs(response:Response,now:number):number|null{
 const header=response.headers.get('retry-after');if(header===null)return null;
 const seconds=Number(header);if(Number.isFinite(seconds)&&seconds>=0)return seconds*1000;
 const date=Date.parse(header);return Number.isNaN(date)?null:Math.max(0,date-now);
}
export function createResilientFetch(options:RpcResilienceOptions={}):typeof fetch{
 const maxRetries=options.maxRetries??3,baseDelayMs=options.baseDelayMs??400,maxDelayMs=options.maxDelayMs??4000,timeoutMs=options.timeoutMs??12_000,deadlineMs=options.deadlineMs??20_000;
 const minIntervalMs=options.minIntervalMs??150,maxConcurrent=options.maxConcurrent??4;
 const doFetch=options.fetchImpl??fetch,sleep=options.sleep??wait,now=options.now??Date.now,random=options.random??Math.random;
 let nextStart=0,active=0;const waiting:Array<()=>void>=[];
 async function acquire(){
  while(active>=maxConcurrent)await new Promise<void>(resolve=>waiting.push(resolve));
  active+=1;
  const start=Math.max(now(),nextStart);nextStart=start+minIntervalMs;
  const gap=start-now();if(gap>0)await sleep(gap);
 }
 function release(){active-=1;waiting.shift()?.();}
 return async(input,init)=>{
  const started=now(),outer=init?.signal??undefined;
  for(let attempt=0;;attempt++){
   if(outer?.aborted)throw outer.reason??new DOMException('Aborted','AbortError');
   let response:Response|undefined,failure:unknown;
   await acquire();
   try{
    const signal=outer?AbortSignal.any([outer,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
    response=await doFetch(input,{...init,signal});
   }catch(error){failure=error;}finally{release();}
   if(outer?.aborted)throw outer.reason??failure??new DOMException('Aborted','AbortError');
   const retryable=response?RETRY_STATUS.has(response.status):true;
   if(!retryable||attempt>=maxRetries)return response??(()=>{throw failure;})();
   const hinted=response?retryAfterMs(response,now()):null;
   const backoff=Math.min(maxDelayMs,baseDelayMs*2**attempt)*(0.5+random()/2);
   const delay=Math.min(maxDelayMs,Math.max(hinted??0,backoff));
   if(now()-started+delay>deadlineMs)return response??(()=>{throw failure;})();
   // Free the connection without waiting: a cancel on a shared (tee'd) body can stay pending until every branch is consumed.
   void response?.body?.cancel().catch(()=>{});
   await sleep(delay);
  }
 };
}
/** One construction point for every Solana connection this product opens (API, worker, settlement, refund). */
export function createRpcConnection(url:string,commitment:Commitment='confirmed',options:RpcResilienceOptions={}){
 const env=Number(process.env.BITPOS_RPC_MIN_INTERVAL_MS);
 return new Connection(url,{commitment,disableRetryOnRateLimit:true,fetch:createResilientFetch({...(Number.isFinite(env)&&env>=0&&process.env.BITPOS_RPC_MIN_INTERVAL_MS?{minIntervalMs:env}:{}),...options})});
}
