import {campaignPromotionDestination} from './promotion-destination';
import type pg from 'pg';
import {z} from 'zod';
import type {PromotionPlacement,PromotionGenerate,PromotionScopeView} from '../../../packages/contracts/src/index';
import {derivedPromotionPrice,promotionDeriveCommandSchema,type PromotionProductSnapshot} from '../../../packages/domain/src/promotions';
import {fail} from './authority';
import {promotionProviderConfiguration} from './promotion-provider';
import {dailyPromotionContext,dailyContextSchema} from './promotion-context';
import {personalPromotionContext,savePersonalJobBinding,guardPersonalJob} from './personal-promotions';
import {renderPromotionAsset} from './promotion-assets';
import {campaignSnapshot,promotionProducts,promotionJobView,promotionCampaignView,type CampaignRow} from './promotions';
export const promotionDeriveSchema=promotionDeriveCommandSchema;
interface RoutingTarget {targetId:string;deviceId:string;assignmentGeneration:string;authGeneration:string;}
export interface DerivationBinding {placement:PromotionPlacement;sourceRevision:number;sourceDiscount:number;targets:RoutingTarget[];occupancyGeneration:string|null;}
export interface DerivationRow {binding:DerivationBinding;origin:'manual_derived'|'ai_regenerated';}
export async function campaignDerivation(db:pg.PoolClient,merchant:string,campaign:string):Promise<DerivationRow|null>{return (await db.query<DerivationRow>('SELECT binding,origin FROM promotion_derivations WHERE merchant_id=$1 AND campaign_id=$2',[merchant,campaign])).rows[0]??null;}
export function campaignPrice(snapshot:PromotionProductSnapshot,percent:number,cap:number,lineage:DerivationRow|null){if(snapshot.bundle)return snapshot.bundle.unitPrice;return derivedPromotionPrice(snapshot.basePrice,snapshot.effectivePrice,percent,cap,lineage?.origin==='manual_derived'?lineage.binding.sourceDiscount:undefined);}
export async function guardDerivation(db:pg.PoolClient,merchant:string,binding:DerivationBinding){
 if(!(await db.query('SELECT bitpos.promotion_derivation_current($1::uuid,$2::jsonb) AS current',[merchant,binding])).rows[0]?.current)fail('PROMOTION_TARGET_CHANGED');
}
export async function guardDerivedJob(db:pg.PoolClient,merchant:string,job:string):Promise<DerivationBinding|null>{const row=(await db.query('SELECT binding FROM promotion_job_derivations WHERE merchant_id=$1 AND job_id=$2',[merchant,job])).rows[0];if(row)await guardDerivation(db,merchant,row.binding);return row?.binding??null;}
export function derivationScope(lineage:DerivationRow|null,percent:number,audience:string):Partial<PromotionScopeView>{
 if(!lineage)return {origin:'generated',priceAuthority:audience==='daily'?'public':'personal'};
 return {placement:lineage.binding.placement,origin:lineage.origin,priceAuthority:audience==='daily'?lineage.binding.placement.priceAuthority:'personal',pricePresentation:lineage.origin==='manual_derived'&&percent===lineage.binding.sourceDiscount?'inherited_source':'independent_discount'};
}
/** The caller owns the routing mutex, source version CAS and idempotency replay. */
export async function derivePromotion(db:pg.PoolClient,merchant:string,actor:string,source:CampaignRow,input:z.infer<typeof promotionDeriveSchema>){
 if(source.state!=='APPROVED'||source.approved_version===null||source.expires_at.getTime()<=Date.now())fail('PROMOTION_STATE_INVALID');
 const scope=(await db.query('SELECT * FROM promotion_scopes WHERE merchant_id=$1 AND campaign_id=$2',[merchant,source.id])).rows[0];if(!scope)fail('PROMOTION_STATE_INVALID');
 const targets=(await db.query(`SELECT t.id AS "targetId",t.target_device_id AS "deviceId",t.assignment_generation::text AS "assignmentGeneration",t.auth_generation::text AS "authGeneration" FROM promotion_playlist_targets t WHERE t.merchant_id=$1 AND t.campaign_id=$2 AND t.campaign_version=$3 ORDER BY t.target_device_id`,[merchant,source.id,source.approved_version])).rows as RoutingTarget[];
 const selected=targets.find(t=>t.deviceId===input.device.deviceId);if(!selected)fail('PROMOTION_TARGET_CHANGED');
 const d=(await db.query(`SELECT d.table_id,d.assignment_generation::text,d.auth_generation::text,s.screen_generation::text,t.occupancy_generation::text,t.retired_at FROM devices d JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.merchant_id=$1 AND d.id=$2 AND d.revoked_at IS NULL`,[merchant,input.device.deviceId])).rows[0];
 if(!d||d.assignment_generation!==input.device.assignmentGeneration||d.auth_generation!==input.device.authGeneration||d.screen_generation!==input.device.screenGeneration||selected.assignmentGeneration!==d.assignment_generation||selected.authGeneration!==d.auth_generation)fail('PROMOTION_TARGET_CHANGED');
 const generatedDestination=await campaignPromotionDestination(db,merchant,source.id);if(generatedDestination&&(input.scope!=='this_table'||input.device.deviceId!==generatedDestination.deviceId))fail('PROMOTION_TARGET_CHANGED');
 const inherited=await campaignDerivation(db,merchant,source.id);
 if((scope.audience!=='daily'||inherited?.binding.placement.kind==='table')&&input.scope!=='this_table')fail('PROMOTION_TARGET_CHANGED');
 if(input.scope==='this_table'&&(!d.table_id||d.retired_at!==null))fail('PROMOTION_TARGET_CHANGED');
 const affected=input.scope==='this_table'?[selected]:targets;
 const sourcePlacement={sourceCampaignId:source.id,sourceVersion:source.version,deviceIds:affected.map(t=>t.deviceId)};
 const placement:PromotionPlacement=input.scope==='this_table'?{...sourcePlacement,kind:'table',tableId:d.table_id,priceAuthority:scope.audience==='daily'?'table':'personal'}:{...sourcePlacement,kind:'campaign_devices',priceAuthority:'public'};
 const binding:DerivationBinding={placement,sourceRevision:source.approved_version,sourceDiscount:source.discount_percent,targets:affected,occupancyGeneration:input.scope==='this_table'?d.occupancy_generation:null};
 await guardDerivation(db,merchant,binding);await guardPersonalJob(db,merchant,source.job_id);
 const products=[await campaignSnapshot(db,merchant,source,binding.placement.tableId??null)];
 if(products[0].priceVersion!==source.snapshot.priceVersion)fail('PROMOTION_REVIEW_REQUIRED');
 if(input.mode==='edit'){
  const price=campaignPrice(products[0],source.discount_percent,source.max_discount_percent,{binding,origin:'manual_derived'});if(BigInt(price.amountMinor)<BigInt(scope.minimum_unit_minor))fail('PROMOTION_REVIEW_REQUIRED');
  const asset=await renderPromotionAsset(db,merchant,products[0].imageUrl,source.headline,source.copy,source.discount_percent,price,undefined,products[0].bundle);
  const c=(await db.query<CampaignRow>(`INSERT INTO promotion_campaigns(merchant_id,job_id,manual_derived,product_id,headline,copy,rationale,discount_percent,max_discount_percent,snapshot,starts_at,expires_at,asset_token,asset_blocker,provenance) VALUES($1,$2,true,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[merchant,source.job_id,source.product_id,source.headline,source.copy,source.rationale,source.discount_percent,source.max_discount_percent,products[0],source.starts_at,source.expires_at,asset.token,asset.blocker,source.provenance])).rows[0];
  await db.query('INSERT INTO promotion_scopes(merchant_id,campaign_id,audience,context,minimum_unit_minor) SELECT merchant_id,$3,audience,context,minimum_unit_minor FROM promotion_scopes WHERE merchant_id=$1 AND campaign_id=$2',[merchant,source.id,c.id]);
  await db.query("INSERT INTO promotion_derivations(merchant_id,campaign_id,binding,origin) VALUES($1,$2,$3,'manual_derived')",[merchant,c.id,binding]);
  return {campaign:await promotionCampaignView(db,merchant,c)};
 }
 const prior=(await db.query('SELECT input FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[merchant,source.job_id])).rows[0]?.input as PromotionGenerate|undefined;if(!prior)fail('PROMOTION_STATE_INVALID');
 const generated:PromotionGenerate={...prior,...(source.snapshot.bundle?{bundle:{unitMinor:source.snapshot.bundle.unitPrice.amountMinor}}:{}),...(input.language?{language:input.language}:{}),productIds:source.snapshot.bundle?source.snapshot.bundle.members.map(m=>m.productId):[source.product_id],startsAt:source.starts_at.toISOString(),expiresAt:source.expires_at.toISOString(),maxDiscountPercent:source.max_discount_percent,idempotencyKey:input.idempotencyKey,minimumUnitMinor:String(scope.minimum_unit_minor)};
 delete generated.destination; // Durable derivation binding replaces the original generation destination.
 const personal=scope.audience==='daily'?null:await personalPromotionContext(db,merchant,scope.audience,generated.personal!);
 const context=scope.audience==='daily'?await dailyPromotionContext(db,merchant,generated.productIds,dailyContextSchema.parse(generated.daily)):personal!.context;
 if(personal?.binding.excludedProductIds.includes(source.product_id))fail('PROMOTION_REVIEW_REQUIRED');
 if(BigInt(generated.minimumUnitMinor)>BigInt(products[0].effectivePrice.amountMinor))fail('PROMOTION_REVIEW_REQUIRED');
 const provider=promotionProviderConfiguration();
 const job=(await db.query('INSERT INTO ai_generation_jobs(merchant_id,state,actor_id,input,products,blocker,provider_origin,provider_model) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[merchant,provider?'QUEUED':'CONFIGURATION_REQUIRED',actor,generated,JSON.stringify(products),provider?null:'CONFIGURATION_REQUIRED',provider?new URL(provider.url).origin:null,provider?.model??null])).rows[0];
 await db.query('INSERT INTO promotion_job_contexts(merchant_id,job_id,audience,context,minimum_unit_minor) VALUES($1,$2,$3,$4,$5)',[merchant,job.id,scope.audience,context,generated.minimumUnitMinor]);
 await db.query('INSERT INTO promotion_job_derivations(merchant_id,job_id,binding) VALUES($1,$2,$3)',[merchant,job.id,binding]);
 if(personal)await savePersonalJobBinding(db,merchant,job.id,personal.binding);
 return {job:promotionJobView(job)};
}
