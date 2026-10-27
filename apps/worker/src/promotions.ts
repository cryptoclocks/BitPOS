import {freshBundle} from '../../api/src/bundle-promotions';
import {jobPromotionDestination} from '../../api/src/promotion-destination';
import {randomUUID} from 'node:crypto';
import {pool,tenant,audit} from '../../api/src/db';
import {routingLock} from '../../api/src/authority';
import {promotionProducts} from '../../api/src/promotions';
import {renderPromotionAsset} from '../../api/src/promotion-assets';
import {promotionProviderConfiguration,openAICompatibleProvider,PromotionProviderFailure,type PromotionProvider,type PromotionProviderConfiguration} from '../../api/src/promotion-provider';
import {reserveAiFree} from '../../api/src/ai-free-policy';
import {promotionPrice,promotionWindow,validatePromotionCandidate,samePromotionSnapshot,type PromotionProductSnapshot} from '../../../packages/domain/src/promotions';
import {reconcilePromotions} from '../../api/src/promotion-lifecycle';
import type {PromotionGenerate} from '../../../packages/contracts/src/index';
import {reconcilePromotionPlaylist} from '../../api/src/promotion-playlists';
import type pg from 'pg';
import type {PromotionAIContext} from '../../../packages/contracts/src/promotion-context';
import {guardPersonalJob} from '../../api/src/personal-promotions';
import {guardDerivedJob} from '../../api/src/promotion-derivation';
import type {DerivationBinding} from '../../api/src/promotion-derivation';
interface JobRow {id:string;merchant_id:string;input:PromotionGenerate;products:PromotionProductSnapshot[];actor_id:string;lease_id:string;context:PromotionAIContext;provider_origin:string|null;provider_model:string|null;derivation:DerivationBinding|null;}
export interface PromotionJobFixture {kind:'fixture_provider';configuration:PromotionProviderConfiguration;provider:PromotionProvider;}
async function expirePromotionJobs(db:pg.PoolClient,merchant:string){
 // Ambiguous/crashed requests retain their reserved budget and are never retried.
 await db.query("UPDATE ai_generation_jobs SET state='FAILED',blocker='PROVIDER_OUTCOME_UNKNOWN',lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE merchant_id=$1 AND state='RUNNING' AND lease_until<=clock_timestamp()",[merchant]);
}
/** Injection is explicitly fixture-only; production always uses private configured adapter. */
export async function runPromotionJob(merchant:string,fixture?:PromotionJobFixture){
 const configuration=fixture?.configuration??promotionProviderConfiguration();
 const lease=randomUUID();
 const job=await tenant(merchant,async db=>{
  await routingLock(db,merchant);
  await expirePromotionJobs(db,merchant);
  // A replacement worker must wait out a live durable lease, not add another job
  // for this merchant while the previous worker's provider outcome is unknown.
  if((await db.query("SELECT 1 FROM ai_generation_jobs WHERE merchant_id=$1 AND state='RUNNING' LIMIT 1",[merchant])).rowCount)return null;
  const origin=configuration?new URL(configuration.url).origin:null;
  if(configuration)await db.query("UPDATE ai_generation_jobs SET blocker='CONFIGURATION_REQUIRED' WHERE merchant_id=$1 AND state='QUEUED' AND (provider_origin IS DISTINCT FROM $2 OR provider_model IS DISTINCT FROM $3)",[merchant,origin,configuration.model]);
  const row=(await db.query<JobRow>("SELECT * FROM ai_generation_jobs WHERE merchant_id=$1 AND state='QUEUED' AND ($2::text IS NULL OR (provider_origin=$2 AND provider_model=$3)) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1",[merchant,origin,configuration?.model??null])).rows[0];if(!row)return null;
  const scope=(await db.query('SELECT context FROM promotion_job_contexts WHERE merchant_id=$1 AND job_id=$2',[merchant,row.id])).rows[0];
  try{if(!scope)throw new Error('Unscoped legacy generation');await guardPersonalJob(db,merchant,row.id);await jobPromotionDestination(db,merchant,row.id);row.derivation=await guardDerivedJob(db,merchant,row.id);row.context=scope.context;}catch{await db.query("UPDATE ai_generation_jobs SET state='FAILED',blocker='PROMOTION_TARGET_CHANGED',finished_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[merchant,row.id]);return null;}
  if(!configuration||!fixture&&new URL(configuration.url).origin!=='https://generativelanguage.googleapis.com'){await db.query("UPDATE ai_generation_jobs SET state='CONFIGURATION_REQUIRED',blocker='CONFIGURATION_REQUIRED',finished_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[merchant,row.id]);return null;}
  try{promotionWindow(row.input.startsAt,row.input.expiresAt);if(row.derivation){const fresh=row.products[0]?.bundle?[await freshBundle(db,merchant,row.products[0].bundle,row.derivation.placement.tableId??null)]:await promotionProducts(db,merchant,row.input.productIds,row.derivation.placement.tableId??null);if(fresh.some((p,i)=>!samePromotionSnapshot(p,row.products[i])))throw Error('PROMOTION_REVIEW_REQUIRED');}}catch{await db.query("UPDATE ai_generation_jobs SET state='FAILED',blocker='PROMOTION_REVIEW_REQUIRED',finished_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[merchant,row.id]);return null;}
  const geminiFree=!fixture&&new URL(configuration.url).origin==='https://generativelanguage.googleapis.com';
  const reserved=geminiFree?await reserveAiFree(db,merchant,row.id,'promotion',null,row.id):(await db.query('SELECT bitpos.reserve_promotion_budget($1::uuid,$2::uuid,$3::text,$4::text,$5::bigint,$6::bigint) AS reserved',[merchant,row.id,new URL(configuration.url).origin,configuration.model,configuration.jobBudget,configuration.dailyBudget])).rows[0].reserved;
  if(!reserved){await db.query("UPDATE ai_generation_jobs SET state='FAILED',blocker=$3,finished_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[merchant,row.id,geminiFree?'AI_FREE_LIMIT':'AI_BUDGET_EXHAUSTED']);return null;}
  if(geminiFree)await db.query('UPDATE ai_generation_jobs SET provider_origin=$3,provider_model=$4 WHERE merchant_id=$1 AND id=$2',[merchant,row.id,new URL(configuration.url).origin,configuration.model]);
  await db.query("UPDATE ai_generation_jobs SET state='RUNNING',blocker=NULL,lease_id=$3,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1 WHERE merchant_id=$1 AND id=$2",[merchant,row.id,lease]);return row;
 });if(!job||!configuration)return;
 let result;
 try{
  result=await (fixture?.provider??openAICompatibleProvider(configuration))({requestedDiscountPercent:job.input.requestedDiscountPercent,jobId:job.id,language:job.input.language,goal:job.input.goal,maxDiscountPercent:job.input.maxDiscountPercent,startsAt:job.input.startsAt,expiresAt:job.input.expiresAt,products:job.products,context:job.context,minimumUnitMinor:job.input.minimumUnitMinor});
  if(result.kind!==(fixture?'fixture_provider':'provider')||result.model!==configuration.model||result.provider!==new URL(configuration.url).origin||!result.requestId||result.requestId.length>200)throw new PromotionProviderFailure('PROVIDER_PROVENANCE_INVALID');
  if(job.input.requestedDiscountPercent!==undefined&&result.candidate.discountPercent!==job.input.requestedDiscountPercent)throw new PromotionProviderFailure('PROVIDER_RESPONSE_INVALID');
  result={...result,candidate:validatePromotionCandidate(result.candidate,job.products,job.input.maxDiscountPercent)};
 }catch(error){await tenant(merchant,async db=>{await routingLock(db,merchant);await db.query("UPDATE ai_generation_jobs SET state='FAILED',blocker=$4,lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state='RUNNING' AND lease_id=$3",[merchant,job.id,lease,error instanceof PromotionProviderFailure?error.code:'PROVIDER_RESPONSE_INVALID']);});return;}
 const response=result;
 const provenance={kind:response.kind,provider:response.provider,model:response.model,requestId:response.requestId,jobId:job.id};
 // Preserve validated external provenance even if fresh catalog review later fails.
 await tenant(merchant,db=>db.query("UPDATE ai_generation_jobs SET provenance=$4,validated_output=$5 WHERE merchant_id=$1 AND id=$2 AND state='RUNNING' AND lease_id=$3",[merchant,job.id,lease,provenance,response.candidate]));
 try{await tenant(merchant,async db=>{
  await routingLock(db,merchant);const current=(await db.query("SELECT 1 FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2 AND state='RUNNING' AND lease_id=$3 AND lease_until>clock_timestamp() FOR UPDATE",[merchant,job.id,lease])).rowCount;if(!current)return;
  const candidate=response.candidate,snapshot=job.products[0]?.bundle?await freshBundle(db,merchant,job.products[0].bundle,job.derivation?.placement.tableId??job.input.destination?.tableId??null):(await promotionProducts(db,merchant,[candidate.productId],job.derivation?.placement.tableId??job.input.destination?.tableId??null))[0];promotionWindow(job.input.startsAt,job.input.expiresAt);const price=snapshot.bundle?.unitPrice??promotionPrice(snapshot.basePrice,snapshot.effectivePrice,candidate.discountPercent,job.input.maxDiscountPercent);
  await jobPromotionDestination(db,merchant,job.id);await guardPersonalJob(db,merchant,job.id);await guardDerivedJob(db,merchant,job.id);if(BigInt(price.amountMinor)<BigInt(job.input.minimumUnitMinor))throw new PromotionProviderFailure('PROVIDER_RESPONSE_INVALID');
  const asset=await renderPromotionAsset(db,merchant,snapshot.imageUrl,candidate.headline,candidate.copy,candidate.discountPercent,price,undefined,snapshot.bundle);
  const c=(await db.query('INSERT INTO promotion_campaigns(merchant_id,job_id,product_id,headline,copy,rationale,discount_percent,max_discount_percent,snapshot,starts_at,expires_at,asset_token,asset_blocker,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id',[merchant,job.id,candidate.productId,candidate.headline,candidate.copy,candidate.rationale,candidate.discountPercent,job.input.maxDiscountPercent,snapshot,job.input.startsAt,job.input.expiresAt,asset.token,asset.blocker,provenance])).rows[0];
  await db.query('INSERT INTO promotion_scopes(merchant_id,campaign_id,audience,context,minimum_unit_minor) SELECT merchant_id,$3,audience,context,minimum_unit_minor FROM promotion_job_contexts WHERE merchant_id=$1 AND job_id=$2',[merchant,job.id,c.id]);
  await db.query("INSERT INTO promotion_derivations(merchant_id,campaign_id,binding,origin) SELECT merchant_id,$3,binding,'ai_regenerated' FROM promotion_job_derivations WHERE merchant_id=$1 AND job_id=$2",[merchant,job.id,c.id]);
  await db.query("UPDATE ai_generation_jobs SET state='SUCCEEDED',campaign_id=$4,provenance=$5,blocker=NULL,lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND lease_id=$3",[merchant,job.id,lease,c.id,provenance]);await audit(db,merchant,job.actor_id,'promotion.draft.generated',c.id);
 });}catch{await tenant(merchant,db=>db.query("UPDATE ai_generation_jobs SET state='FAILED',blocker='PROMOTION_REVIEW_REQUIRED',lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2 AND state='RUNNING' AND lease_id=$3",[merchant,job.id,lease]));}
}
export async function tickPromotions(){
 const merchants=(await pool.query('SELECT merchant_id FROM bitpos.promotion_work_queue()')).rows;
 for(const row of merchants){try{
  await tenant(row.merchant_id,async db=>{await routingLock(db,row.merchant_id);await expirePromotionJobs(db,row.merchant_id);const devices=(await db.query(`SELECT d.id AS target_device_id,p.connection_generation::text FROM devices d LEFT JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id WHERE d.merchant_id=$1 AND (EXISTS(SELECT 1 FROM promotion_targets t WHERE t.merchant_id=d.merchant_id AND t.target_device_id=d.id AND t.state IN ('QUEUED','DELIVERED','RENDERED')) OR EXISTS(SELECT 1 FROM promotion_playlist_targets t WHERE t.merchant_id=d.merchant_id AND t.target_device_id=d.id AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED')))`,[row.merchant_id])).rows;for(const d of devices){await reconcilePromotions(db,row.merchant_id,d.target_device_id,d.connection_generation??'0');await reconcilePromotionPlaylist(db,row.merchant_id,d.target_device_id,d.connection_generation??'0');}});
 }catch{console.error('Promotion reconciliation unavailable; durable state retained');}}
}
/** Single job lane, sequential and bounded to one provider call per worker. */
export async function tickPromotionJobs(signal:AbortSignal,fixture?:PromotionJobFixture){
 const merchants=(await pool.query('SELECT merchant_id FROM bitpos.promotion_work_queue() ORDER BY merchant_id')).rows;
 for(const row of merchants){
  if(signal.aborted)return;
  try{await runPromotionJob(row.merchant_id,fixture);}catch{console.error('Promotion generation unavailable; durable state retained');}
 }
}
