// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
import type {z} from 'zod';

export type MetaProviderId='meta_api'|'baseten'|'modal'|'local_mac'|'local_v100';
export type MetaTask='counter_reasoning'|'tray_reasoning'|'promotion_copy'|'poster_direction';
export type MetaWeights='closed'|'open';
export type MetaLocation='cloud'|'self_hosted';
export type MetaOutcome='OK'|'PROVIDER_TIMEOUT'|'PROVIDER_UNREACHABLE'|'PROVIDER_RATE_LIMITED'|'PROVIDER_AUTH_REJECTED'|'PROVIDER_UNAVAILABLE'|'PROVIDER_REJECTED'|'PROVIDER_RESPONSE_TOO_LARGE'|'PROVIDER_RESPONSE_INVALID'|'OUTPUT_SCHEMA_INVALID';

/** One OpenAI-compatible chat-completions endpoint (Meta Model API compat layer, Baseten, Modal vLLM, local vLLM/MLX/llama.cpp). */
export interface MetaProviderConfig {
 id:MetaProviderId;
 baseUrl:string;
 apiKey?:string;
 model:string;
 weights:MetaWeights;
 location:MetaLocation;
 timeoutMs:number;
 supportsJsonSchema:boolean;
 supportsImages:boolean;
}

export type MetaContentPart={type:'text';text:string}|{type:'image_url';image_url:{url:string}};
export interface MetaMessage {role:'system'|'user'|'assistant';content:string|MetaContentPart[];}

export interface MetaOutputSpec<T> {name:string;schema:z.ZodType<T>;jsonSchema:Record<string,unknown>;}

export interface MetaInvokeRequest<T> {
 task:MetaTask;
 merchantId:string;
 runId?:string;
 messages:MetaMessage[];
 output:MetaOutputSpec<T>;
 maxOutputTokens?:number;
 /** Dashboard toggle: try this location first, still fall back to the other. */
 prefer?:MetaLocation;
 /** Open-weight-only proof runs never fall back to a closed model. */
 requireOpenWeights?:boolean;
 deadlineMs?:number;
 signal?:AbortSignal;
}

export interface MetaInvocation {
 id:string;
 merchantId:string;
 runId:string|null;
 task:MetaTask;
 provider:MetaProviderId;
 model:string;
 weights:MetaWeights;
 location:MetaLocation;
 outcome:MetaOutcome;
 latencyMs:number;
 inputSha256:string;
 outputSha256:string|null;
 output:unknown|null;
 promptTokens:number|null;
 completionTokens:number|null;
 reasoningTokens:number|null;
 startedAt:string;
}

export interface MetaInvokeResult<T> {value:T;invocation:MetaInvocation;attempts:MetaInvocation[];}

export class MetaRouterError extends Error {
 constructor(readonly code:'NO_PROVIDER_AVAILABLE'|'ALL_PROVIDERS_FAILED'|'DEADLINE_EXCEEDED'|'ABORTED',readonly attempts:MetaInvocation[]=[]){super(code);}
}
