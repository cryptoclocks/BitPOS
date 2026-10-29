// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {MetaRouterError,type MetaToolsRequest,type MetaToolsResult,type MetaInvocation,type MetaInvokeRequest,type MetaInvokeResult,type MetaLocation,type MetaOutcome,type MetaProviderConfig,type MetaProviderId,type MetaTask} from './types';

const sha256=(v:string)=>createHash('sha256').update(v).digest('hex');
const PROVIDERS:MetaProviderId[]=['meta_api','baseten','modal','local_mac','local_v100'];

/** Plain HTTP only for a self-hosted node on loopback or a Tailscale CGNAT address; never for a cloud provider. */
export function providerUrlAllowed(baseUrl:string,location:MetaLocation){
 let u:URL;try{u=new URL(baseUrl);}catch{return false;}
 if(u.username||u.password||u.search||u.hash)return false;
 if(u.protocol==='https:')return true;
 if(u.protocol!=='http:'||location!=='self_hosted')return false;
 const h=u.hostname;if(h==='localhost'||h==='127.0.0.1'||h==='[::1]')return true;
 const m=h.match(/^100\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);return !!m&&Number(m[1])>=64&&Number(m[1])<=127;
}

const envProvider=z.object({baseUrl:z.string().min(1),apiKey:z.string().min(1).optional(),model:z.string().min(1).max(200),timeoutMs:z.coerce.number().int().min(1000).max(120000).default(20000),supportsJsonSchema:z.enum(['0','1']).default('1'),supportsImages:z.enum(['0','1']).default('0')});
const DEFAULTS:Record<MetaProviderId,{weights:'closed'|'open';location:MetaLocation}>={meta_api:{weights:'closed',location:'cloud'},baseten:{weights:'open',location:'cloud'},modal:{weights:'open',location:'cloud'},local_mac:{weights:'open',location:'self_hosted'},local_v100:{weights:'open',location:'self_hosted'}};

/** META_AI_<ID>_URL / _KEY / _MODEL / _TIMEOUT_MS / _JSON_SCHEMA / _IMAGES. Unset providers are skipped; invalid ones throw. */
export function metaProvidersFromEnv(env:NodeJS.ProcessEnv=process.env):MetaProviderConfig[]{
 return PROVIDERS.flatMap(id=>{
  const p='META_AI_'+id.toUpperCase()+'_';if(!env[p+'URL'])return [];
  const c=envProvider.parse({baseUrl:env[p+'URL'],apiKey:env[p+'KEY']||undefined,model:env[p+'MODEL'],timeoutMs:env[p+'TIMEOUT_MS'],supportsJsonSchema:env[p+'JSON_SCHEMA'],supportsImages:env[p+'IMAGES']});
  const d=DEFAULTS[id];if(!providerUrlAllowed(c.baseUrl,d.location))throw Error('META_PROVIDER_URL_REJECTED:'+id);
  if(d.location==='cloud'&&!c.apiKey)throw Error('META_PROVIDER_KEY_REQUIRED:'+id);
  return [{id,...d,baseUrl:c.baseUrl.replace(/\/+$/,''),apiKey:c.apiKey,model:c.model,timeoutMs:c.timeoutMs,supportsJsonSchema:c.supportsJsonSchema==='1',supportsImages:c.supportsImages==='1'}];
 });
}

export const DEFAULT_ROUTES:Record<MetaTask,MetaProviderId[]>={
 counter_reasoning:['local_mac','baseten','modal','meta_api'],
 tray_reasoning:['local_mac','baseten','modal','meta_api'],
 promotion_copy:['meta_api','baseten','local_mac','modal'],
 poster_direction:['meta_api','baseten','local_mac','modal'],
 offer_selection:['meta_api','baseten','modal','local_mac'],
 agent_order:['meta_api','baseten','modal','local_mac'],
 agent_tools:['meta_api'],
 owner_insights:['meta_api'],
};

export interface MetaRouterOptions {
 providers:MetaProviderConfig[];
 routes?:Partial<Record<MetaTask,MetaProviderId[]>>;
 fetch?:typeof fetch;
 now?:()=>number;
 /** Durable evidence sink (meta_ai_invocations). A sink failure is counted, never turned into a fake inference failure. */
 record?:(invocation:MetaInvocation)=>Promise<void>;
 maxResponseBytes?:number;
 breakerThreshold?:number;
 breakerCooldownMs?:number;
}

class Attempt extends Error {constructor(readonly outcome:MetaOutcome){super(outcome);}}

const envelope=z.object({
 model:z.string().max(200).optional(),
 choices:z.array(z.object({finish_reason:z.string().nullable(),message:z.object({content:z.string().max(200000).nullable()})})).min(1),
 usage:z.object({prompt_tokens:z.number().int().nonnegative().optional(),completion_tokens:z.number().int().nonnegative().optional(),completion_tokens_details:z.object({reasoning_tokens:z.number().int().nonnegative().optional()}).nullish()}).nullish(),
});

/** Strip one markdown fence some open-weight servers add when JSON mode is unavailable. */
function jsonContent(text:string){const t=text.trim();const m=t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);return JSON.parse(m?m[1]:t) as unknown;}

export function createMetaRouter(options:MetaRouterOptions){
 const doFetch=options.fetch??fetch,now=options.now??Date.now,limit=options.maxResponseBytes??65536;
 const threshold=options.breakerThreshold??3,cooldown=options.breakerCooldownMs??30000;
 const routes={...DEFAULT_ROUTES,...options.routes};
 const health=new Map<MetaProviderId,{failures:number;openUntil:number}>();
 let sinkFailures=0;

 function candidates(task:MetaTask,needsImages:boolean,requireOpen:boolean,prefer?:MetaLocation){
  const list=routes[task].map(id=>options.providers.find(p=>p.id===id)).filter((p):p is MetaProviderConfig=>!!p&&(!needsImages||p.supportsImages)&&(!requireOpen||p.weights==='open'));
  return prefer?[...list.filter(p=>p.location===prefer),...list.filter(p=>p.location!==prefer)]:list;
 }

 async function call(p:MetaProviderConfig,req:MetaInvokeRequest<unknown>,timeoutMs:number){
  const body:Record<string,unknown>={model:p.model,messages:req.messages,temperature:0,max_completion_tokens:req.maxOutputTokens??1024,...(req.reasoningEffort?{reasoning_effort:req.reasoningEffort}:{})};
  if(p.supportsJsonSchema)body.response_format={type:'json_schema',json_schema:{name:req.output.name,strict:true,schema:req.output.jsonSchema}};
  const signals=[AbortSignal.timeout(timeoutMs),...(req.signal?[req.signal]:[])];
  let response:Response;
  try{response=await doFetch(p.baseUrl+'/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.any(signals),headers:{'Content-Type':'application/json',...(p.apiKey?{Authorization:'Bearer '+p.apiKey}:{})},body:JSON.stringify(body)});}
  catch(e){throw new Attempt((e as Error)?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'PROVIDER_UNREACHABLE');}
  if(!response.ok){await response.body?.cancel();throw new Attempt(response.status===429?'PROVIDER_RATE_LIMITED':response.status===401||response.status===403?'PROVIDER_AUTH_REJECTED':response.status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_REJECTED');}
  const reader=response.body?.getReader();if(!reader)throw new Attempt('PROVIDER_RESPONSE_INVALID');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();throw new Attempt('PROVIDER_RESPONSE_TOO_LARGE');}chunks.push(next.value);}}
  catch(e){if(e instanceof Attempt)throw e;throw new Attempt((e as Error)?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'PROVIDER_UNREACHABLE');}
  let parsed:z.infer<typeof envelope>,raw:unknown;
  try{parsed=envelope.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));const choice=parsed.choices[0];if(choice.finish_reason!=='stop'||!choice.message.content)throw Error();raw=jsonContent(choice.message.content);}
  catch{throw new Attempt('PROVIDER_RESPONSE_INVALID');}
  const checked=req.output.schema.safeParse(raw);if(!checked.success)throw new Attempt('OUTPUT_SCHEMA_INVALID');
  return {value:checked.data,model:parsed.model??p.model,usage:parsed.usage??null};
 }

 async function persist(invocation:MetaInvocation){if(!options.record)return;try{await options.record(invocation);}catch{sinkFailures++;}}

 async function invoke<T>(req:MetaInvokeRequest<T>):Promise<MetaInvokeResult<T>>{
  const started=now(),deadline=started+(req.deadlineMs??45000);
  const needsImages=req.messages.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image_url'));
  const inputSha256=sha256(JSON.stringify([req.task,req.output.name,req.messages]));
  const list=candidates(req.task,needsImages,!!req.requireOpenWeights,req.prefer);
  if(!list.length)throw new MetaRouterError('NO_PROVIDER_AVAILABLE');
  const attempts:MetaInvocation[]=[];let skipped=0;
  for(const p of list){
   if(req.signal?.aborted)throw new MetaRouterError('ABORTED',attempts);
   const h=health.get(p.id);if(h&&h.openUntil>now()){skipped++;continue;}
   const remaining=deadline-now();if(remaining<1000)throw new MetaRouterError('DEADLINE_EXCEEDED',attempts);
   const at=now();
   const base={id:randomUUID(),merchantId:req.merchantId,runId:req.runId??null,task:req.task,provider:p.id,weights:p.weights,location:p.location,inputSha256,startedAt:new Date(at).toISOString()};
   try{
    const r=await call(p,req as MetaInvokeRequest<unknown>,Math.min(p.timeoutMs,remaining));
    const output=JSON.stringify(r.value);
    const invocation:MetaInvocation={...base,model:r.model,outcome:'OK',latencyMs:now()-at,outputSha256:sha256(output),output:r.value,promptTokens:r.usage?.prompt_tokens??null,completionTokens:r.usage?.completion_tokens??null,reasoningTokens:r.usage?.completion_tokens_details?.reasoning_tokens??null};
    health.set(p.id,{failures:0,openUntil:0});attempts.push(invocation);await persist(invocation);
    return {value:r.value as T,invocation,attempts};
   }catch(e){
    if(!(e instanceof Attempt))throw e;
    if(req.signal?.aborted)throw new MetaRouterError('ABORTED',attempts);
    const failures=(health.get(p.id)?.failures??0)+1;health.set(p.id,{failures,openUntil:failures>=threshold?now()+cooldown:0});
    const invocation:MetaInvocation={...base,model:p.model,outcome:e.outcome,latencyMs:now()-at,outputSha256:null,output:null,promptTokens:null,completionTokens:null,reasoningTokens:null};
    attempts.push(invocation);await persist(invocation);
   }
  }
  throw new MetaRouterError(attempts.length||!skipped?'ALL_PROVIDERS_FAILED':'NO_PROVIDER_AVAILABLE',attempts);
 }

 /** Tool calling on the Meta Model API (chat completions with tools, parallel tool calls): the model asks, the server runs
  * the named tools with checked arguments, and the results go back until the model answers in text (max rounds). Every
  * round is recorded like invoke(). Tool arguments that fail their schema are answered with an error, not run. */
 async function invokeTools(req:MetaToolsRequest):Promise<MetaToolsResult>{
  const p=options.providers.find(x=>x.id==='meta_api');
  if(!p)throw new MetaRouterError('NO_PROVIDER_AVAILABLE');
  const model=req.model??p.model,started=now(),deadline=started+(req.deadlineMs??45000);
  const messages:any[]=[...req.messages],calls:MetaToolsResult['calls']=[],invocations:MetaInvocation[]=[];
  const tools=req.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}));
  for(let round=0;round<(req.maxRounds??4);round++){
   const remaining=deadline-now();if(remaining<1000)throw new MetaRouterError('DEADLINE_EXCEEDED',invocations);
   const at=now(),base={id:randomUUID(),merchantId:req.merchantId,runId:null,task:req.task,provider:p.id,weights:p.weights,location:p.location,inputSha256:sha256(JSON.stringify([req.task,model,messages])),startedAt:new Date(at).toISOString()};
   let body:any;
   try{
    const r=await doFetch(p.baseUrl+'/chat/completions',{method:'POST',redirect:'error',signal:AbortSignal.timeout(Math.min(remaining,p.timeoutMs*2)),headers:{'Content-Type':'application/json',...(p.apiKey?{Authorization:'Bearer '+p.apiKey}:{})},
     body:JSON.stringify({model,messages,tools,tool_choice:'auto',parallel_tool_calls:true,temperature:0,max_completion_tokens:req.maxOutputTokens??1500,...(req.reasoningEffort?{reasoning_effort:req.reasoningEffort}:{})})});
    if(!r.ok){await r.body?.cancel();throw new Attempt(r.status===429?'PROVIDER_RATE_LIMITED':r.status>=500?'PROVIDER_UNAVAILABLE':'PROVIDER_REJECTED');}
    const text=await r.text();if(text.length>limit*4)throw new Attempt('PROVIDER_RESPONSE_TOO_LARGE');
    body=JSON.parse(text);if(!body?.choices?.[0]?.message)throw new Attempt('PROVIDER_RESPONSE_INVALID');
   }catch(e){
    const outcome=e instanceof Attempt?e.outcome:(e as Error)?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'PROVIDER_UNREACHABLE';
    const inv:MetaInvocation={...base,model,outcome,latencyMs:now()-at,outputSha256:null,output:null,promptTokens:null,completionTokens:null,reasoningTokens:null};
    invocations.push(inv);await persist(inv);throw new MetaRouterError('ALL_PROVIDERS_FAILED',invocations);
   }
   const msg=body.choices[0].message,asked=Array.isArray(msg.tool_calls)?msg.tool_calls.slice(0,8):[];
   const out={round,toolCalls:asked.map((c:any)=>c?.function?.name),text:typeof msg.content==='string'?msg.content.slice(0,2000):null};
   const inv:MetaInvocation={...base,model:typeof body.model==='string'?body.model:model,outcome:'OK',latencyMs:now()-at,outputSha256:sha256(JSON.stringify(out)),output:out,promptTokens:body.usage?.prompt_tokens??null,completionTokens:body.usage?.completion_tokens??null,reasoningTokens:body.usage?.completion_tokens_details?.reasoning_tokens??null};
   invocations.push(inv);await persist(inv);
   if(!asked.length)return {text:typeof msg.content==='string'?msg.content:'',calls,invocations,model:inv.model};
   messages.push({role:'assistant',content:msg.content??null,tool_calls:asked});
   // Parallel tool calls run together; each result (or a refusal) goes back with its call id.
   const results=await Promise.all(asked.map(async(c:any)=>{
    const tool=req.tools.find(t=>t.name===c?.function?.name);let args:unknown;
    try{args=JSON.parse(c?.function?.arguments||'{}');}catch{args=null;}
    const ok=tool?tool.args.safeParse(args):null;
    if(!tool||!ok?.success)return {call:{name:String(c?.function?.name),args,ok:false},msg:{role:'tool',tool_call_id:c.id,content:JSON.stringify({error:'INVALID_ARGUMENTS'})}};
    try{const result=await tool.run(ok.data);return {call:{name:tool.name,args:ok.data,ok:true},msg:{role:'tool',tool_call_id:c.id,content:JSON.stringify(result).slice(0,20000)}};}
    catch(e){return {call:{name:tool.name,args:ok.data,ok:false},msg:{role:'tool',tool_call_id:c.id,content:JSON.stringify({error:(e as Error)?.message?.slice(0,100)??'FAILED'})}};}
   }));
   // Kept in the order the model asked, whatever order they finished in.
   for(const r of results){calls.push(r.call);messages.push(r.msg);}
  }
  throw new MetaRouterError('DEADLINE_EXCEEDED',invocations);
 }

 return {
  invoke,
  invokeTools,
  /** Dashboard view: configured providers, breaker state and evidence-sink failures. No keys. */
  status:()=>({sinkFailures,providers:options.providers.map(p=>({id:p.id,model:p.model,weights:p.weights,location:p.location,breakerOpen:(health.get(p.id)?.openUntil??0)>now(),consecutiveFailures:health.get(p.id)?.failures??0}))}),
 };
}
export type MetaRouter=ReturnType<typeof createMetaRouter>;
