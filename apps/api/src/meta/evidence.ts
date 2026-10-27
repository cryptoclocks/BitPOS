// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Persists every Meta model attempt (including failures) to the tenant's invocation ledger.
import type {MetaInvocation} from '../../../../packages/meta-ai/src/types';
import type {MetaDb} from './identity';

export function invocationSink(db:MetaDb):(i:MetaInvocation)=>Promise<void>{
 return async i=>{
  await db.tenant(i.merchantId,c=>c.query('INSERT INTO meta_ai_invocations(merchant_id,id,run_id,task,provider,model,weights,location,outcome,latency_ms,input_sha256,output_sha256,output,prompt_tokens,completion_tokens,reasoning_tokens,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
   [i.merchantId,i.id,i.runId,i.task,i.provider,i.model,i.weights,i.location,i.outcome,i.latencyMs,i.inputSha256,i.outputSha256,i.output===null?null:JSON.stringify(i.output),i.promptTokens,i.completionTokens,i.reasoningTokens,i.startedAt]));
 };
}
