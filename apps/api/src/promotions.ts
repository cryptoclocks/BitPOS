import {bundleGeneration} from '../../../packages/contracts/src/bundle-promotions';
import {bundleSnapshot,aggregateBundle} from '../../../packages/domain/src/bundle-promotions';
import {freshBundle} from './bundle-promotions';
import {promotionDestination} from '../../../packages/contracts/src/promotion-destination';
import {guardPromotionDestination,campaignPromotionDestination} from './promotion-destination';
import type pg from 'pg';
import {z} from 'zod';
import type {PromotionCampaign,PromotionJob,PromotionTarget,PromotionDevice,PromotionProvenance,PromotionState} from '../../../packages/contracts/src/index';
import {hash} from '../../../packages/domain/src/index';
import {promotionPrice,promotionCandidate,promotionWindow,samePromotionSnapshot,type PromotionProductSnapshot} from '../../../packages/domain/src/promotions';
import {effectiveCatalog} from './catalog';
import {audit} from './db';
import {fail,requireRole,routingLock,uuid,positive} from './authority';
import {promotionProviderConfiguration} from './promotion-provider';
import {promotionImage,promotionMediaUrl,renderPromotionAsset,validatePromotionAssetFresh} from './promotion-assets';
import {cancelPromotionTarget} from './promotion-lifecycle';
import {dailyContextSchema,dailyPromotionContext} from './promotion-context';
import {playlistPublishSchema,playlistTargetsView,reconcilePromotionPlaylist,publishCampaignPlaylist,currentPromotionPlaylist} from './promotion-playlists';
import type {PromotionAIContext} from '../../../packages/contracts/src/promotion-context';
import {personalPromotionContext,savePersonalJobBinding,guardPersonalJob,personalRecipientsView,personalCampaignBinding} from './personal-promotions';
import {seatCustomer} from './merchant-recipient';
import {promotionDeriveSchema,derivePromotion,campaignDerivation,campaignPrice,guardDerivation,derivationScope} from './promotion-derivation';
const key=z.string().min(1).max(128),date=z.string().datetime({offset:true});
export const promotionGenerateSchema=z.object({bundle:bundleGeneration.optional(),destination:promotionDestination.optional(),requestedDiscountPercent:z.number().int().min(1).max(99).optional(),language:z.enum(['th','en']).optional(),productIds:z.array(uuid).min(1).max(2).refine(v=>new Set(v).size===v.length),goal:z.string().min(1).max(500),maxDiscountPercent:z.number().int().min(1).max(99),startsAt:date,expiresAt:date,idempotencyKey:key,audience:z.enum(['daily','customer','from_order']),minimumUnitMinor:positive,daily:dailyContextSchema.optional(),personal:z.object({tableId:uuid,occupancyGeneration:positive,recipientVisitId:uuid,customerId:uuid.optional(),sourceOrderId:uuid.optional(),confirmRecipient:z.literal(true)}).strict().optional()}).strict().superRefine((d,ctx)=>{if(d.productIds.length!==(d.bundle?2:1)||d.bundle&&d.audience!=='daily')ctx.addIssue({code:'custom',message:'Select one product or one daily pair'});if(d.destination&&d.audience!=='daily')ctx.addIssue({code:'custom',message:'Device destination requires daily context'});if(d.requestedDiscountPercent!==undefined&&d.requestedDiscountPercent>d.maxDiscountPercent)ctx.addIssue({code:'custom',message:'Requested discount exceeds cap'});if(d.audience==='daily'?(!!d.personal||!d.daily):(!d.personal||!!d.daily))ctx.addIssue({code:'custom',message:'Audience context required'});});
const mutation=z.object({expectedVersion:z.number().int().positive(),idempotencyKey:key}).strict();
const edit=mutation.extend({bundleUnitMinor:positive.optional(),headline:promotionCandidate.shape.headline.optional(),copy:promotionCandidate.shape.copy.optional(),discountPercent:promotionCandidate.shape.discountPercent.optional(),startsAt:date.optional(),expiresAt:date.optional()}).strict();
export interface CampaignRow {merchant_id:string;id:string;job_id:string;version:number;state:'DRAFT'|'APPROVED'|'REVOKED'|'EXPIRED'|'FAILED';product_id:string;headline:string;copy:string;rationale:string;discount_percent:number;max_discount_percent:number;snapshot:PromotionProductSnapshot;starts_at:Date;expires_at:Date;asset_token:string|null;asset_blocker:string|null;provenance:PromotionProvenance;approved_version:number|null;}
export function promotionJobView(r:{id:string;state:PromotionJob['state'];blocker:string|null;campaign_id:string|null;created_at:Date;provenance:PromotionProvenance|null}):PromotionJob{return {id:r.id,state:r.state,blocker:r.blocker,campaignId:r.campaign_id,createdAt:new Date(r.created_at).toISOString(),provenance:r.provenance};}
export async function promotionProducts(db:pg.PoolClient,merchant:string,ids:string[],tableId:string|null=null):Promise<PromotionProductSnapshot[]>{
 // Same product locks as stock reservation; routing lock must be acquired first.
 await db.query('SELECT id FROM products WHERE merchant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[merchant,ids]);
 const menu=await effectiveCatalog(db,merchant,tableId);if(!menu.priceVersion)fail('SETUP_REQUIRED');
 return ids.map(id=>{const p=menu.products.find(p=>p.id===id);if(!p?.basePrice||!p.unitPrice)fail('RESOURCE_NOT_FOUND',404);if(p.available<1)fail('STOCK_UNAVAILABLE');return {productId:id,name:p.name,nameEn:p.nameEn,category:typeof p.category==='string'?p.category:null,stock:p.available,basePrice:p.basePrice,effectivePrice:p.unitPrice,priceVersion:menu.priceVersion!,imageUrl:typeof p.imageUrl==='string'?p.imageUrl:null};});
}
export async function promotionTargetView(db:pg.PoolClient,merchant:string,r:Record<string,any>):Promise<PromotionTarget>{
 return {id:r.id,campaignId:r.campaign_id,state:new Date(r.expires_at).getTime()<=Date.now()&&!['REVOKED','FAILED'].includes(r.state)?'EXPIRED':r.state,targetDeviceId:r.target_device_id,assignmentGeneration:String(r.assignment_generation),authGeneration:String(r.auth_generation),screenGeneration:String(r.screen_generation),expiresAt:new Date(r.expires_at).toISOString(),menuUrl:r.menu_url,image:await promotionImage(db,merchant,r.asset_token),previewUrl:r.asset_token?promotionMediaUrl(r.asset_token,true):null,failure:r.failure};
}
export async function campaignSnapshot(db:pg.PoolClient,merchant:string,c:CampaignRow,tableId:string|null){return c.snapshot.bundle?freshBundle(db,merchant,c.snapshot.bundle,tableId):(await promotionProducts(db,merchant,[c.product_id],tableId))[0];}
export async function promotionCampaignView(db:pg.PoolClient,merchant:string,c:CampaignRow):Promise<PromotionCampaign>{
 const rows=(await db.query('SELECT * FROM promotion_targets WHERE merchant_id=$1 AND campaign_id=$2 ORDER BY created_at DESC,id DESC',[merchant,c.id])).rows;const targets=await Promise.all(rows.map(r=>promotionTargetView(db,merchant,r)));
 const scoped=(await db.query('SELECT audience,context,minimum_unit_minor::text AS "minimumUnitMinor" FROM promotion_scopes WHERE merchant_id=$1 AND campaign_id=$2',[merchant,c.id])).rows[0];
 if(scoped&&scoped.audience!=='daily')scoped.binding=await personalCampaignBinding(db,merchant,c.job_id);
 const destination=await campaignPromotionDestination(db,merchant,c.id);if(destination&&scoped){scoped.placement={kind:'table',tableId:destination.tableId,deviceIds:[destination.deviceId],priceAuthority:'table'};scoped.priceAuthority='table';}
 const lineage=await campaignDerivation(db,merchant,c.id);if(scoped)Object.assign(scoped,derivationScope(lineage,c.discount_percent,scoped.audience));if(destination&&scoped)scoped.priceAuthority='table';
 const state:PromotionState=c.state;
 return {id:c.id,version:c.version,approvedVersion:c.approved_version,state:new Date(c.expires_at).getTime()<=Date.now()&&!['REVOKED','FAILED'].includes(state)?'EXPIRED':state,productId:c.product_id,headline:c.headline,copy:c.copy,rationale:c.rationale,discountPercent:c.discount_percent,maxDiscountPercent:c.max_discount_percent,basePrice:c.snapshot.basePrice,unitPrice:c.snapshot.bundle?.unitPrice??campaignPrice(c.snapshot,c.discount_percent,c.max_discount_percent,lineage),...(c.snapshot.bundle?{bundle:c.snapshot.bundle}:{}),priceVersion:c.snapshot.priceVersion,stockSnapshot:c.snapshot.stock,startsAt:new Date(c.starts_at).toISOString(),expiresAt:new Date(c.expires_at).toISOString(),imageUrl:c.snapshot.imageUrl,previewUrl:c.asset_token?promotionMediaUrl(c.asset_token,true):null,assetBlocker:c.asset_blocker,provenance:c.provenance,targets,...(scoped?{scope:scoped,playlistTargets:await playlistTargetsView(db,merchant,c.id)}:{})};
}
export async function promotionDevices(db:pg.PoolClient,merchant:string):Promise<PromotionDevice[]>{
 return (await db.query(`SELECT d.id AS "deviceId",d.label,d.table_id AS "tableId",t.label AS "tableLabel",coalesce(p.connected_until>clock_timestamp(),false) AS online,coalesce(s.kind<>'idle',false) OR EXISTS(SELECT 1 FROM pickup_notifications n WHERE n.merchant_id=d.merchant_id AND n.target_device_id=d.id AND n.state IN ('PENDING','DELIVERED','RENDERED') AND n.expires_at>clock_timestamp()) AS busy,coalesce(c.connection_generation=p.connection_generation AND 'promotion_playlist_v1'=ANY(c.capabilities),false) AS capable,d.assignment_generation::text AS "assignmentGeneration",d.auth_generation::text AS "authGeneration",s.screen_generation::text AS "screenGeneration" FROM devices d JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id LEFT JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id LEFT JOIN device_capabilities c ON c.merchant_id=d.merchant_id AND c.device_id=d.id WHERE d.merchant_id=$1 AND d.revoked_at IS NULL ORDER BY d.label,d.id`,[merchant])).rows;
}
export async function promotionsRequest(db:pg.PoolClient,merchant:string,actor:string,role:string,path:string,method:string,input:unknown){
 if(path==='/api/promotions/recipients/seat'&&method==='POST')return seatCustomer(db,merchant,actor,role,input);
 const match=path.match(/^\/api\/promotions(?:\/(generate|jobs\/[^/]+|devices\/[^/]+|[^/]+)(?:\/(preview|approve|publish|revoke|derive))?)?$/);if(!match)return undefined;
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 if(method==='GET'){
  if(match[2])fail('RESOURCE_NOT_FOUND',404);
  if(match[1]?.startsWith('devices/')){
   const id=uuid.parse(match[1].slice(8));await routingLock(db,merchant);const device=(await promotionDevices(db,merchant)).find(d=>d.deviceId===id);if(!device)fail('RESOURCE_NOT_FOUND',404);
   const playlist=await currentPromotionPlaylist(db,merchant,id);
   // Inspection is independently bounded live delivery history, not current screen selection.
   // Keep selected receipts within the bound, without excluding future or overflow targets.
   const receipts=(await db.query<{id:string;campaign_id:string}>(`SELECT t.id,t.campaign_id FROM promotion_playlist_targets t
    JOIN promotion_revisions r ON r.merchant_id=t.merchant_id AND r.campaign_id=t.campaign_id AND r.version=t.campaign_version
    WHERE t.merchant_id=$1 AND t.target_device_id=$2 AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED')
    AND bitpos.playlist_target_current(t.merchant_id,t.id)
    ORDER BY (t.id=ANY($3::uuid[])) DESC,t.created_at DESC,t.id DESC LIMIT 100`,[merchant,id,playlist.items.map(i=>i.targetId)])).rows;
   const receiptIds=new Set(receipts.map(t=>t.id)),ids=[...new Set(receipts.map(t=>t.campaign_id))];
   const campaigns=(await db.query<CampaignRow>('SELECT * FROM promotion_campaigns WHERE merchant_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at DESC,id DESC',[merchant,ids])).rows;
   return {device,playlist,campaigns:await Promise.all(campaigns.map(async c=>{
    const view=await promotionCampaignView(db,merchant,c);
    return {...view,targets:view.targets.filter(t=>t.targetDeviceId===id),playlistTargets:view.playlistTargets?.filter(t=>receiptIds.has(t.id))};
   }))};
  }
  if(match[1]==='recipients')return await personalRecipientsView(db,merchant);
  if(!match[1]){const provider=promotionProviderConfiguration();const campaigns=(await db.query<CampaignRow>('SELECT * FROM promotion_campaigns WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100',[merchant])).rows;return {provider:{configured:!!provider,blocker:provider?null:'CONFIGURATION_REQUIRED'},jobs:(await db.query('SELECT * FROM ai_generation_jobs WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 100',[merchant])).rows.map(promotionJobView),campaigns:await Promise.all(campaigns.map(c=>promotionCampaignView(db,merchant,c))),devices:await promotionDevices(db,merchant)};}
  if(match[1].startsWith('jobs/')){const job=(await db.query('SELECT * FROM ai_generation_jobs WHERE merchant_id=$1 AND id=$2',[merchant,uuid.parse(match[1].slice(5))])).rows[0];if(!job)fail('RESOURCE_NOT_FOUND',404);return {job:promotionJobView(job)};}
  const c=(await db.query<CampaignRow>('SELECT * FROM promotion_campaigns WHERE merchant_id=$1 AND id=$2',[merchant,uuid.parse(match[1])])).rows[0];if(!c)fail('RESOURCE_NOT_FOUND',404);return {campaign:await promotionCampaignView(db,merchant,c)};
 }
 if(match[1]==='generate'&&method==='POST'){
  requireRole(role);const d=promotionGenerateSchema.parse(input),digest=hash(JSON.stringify(['generate',d]));await routingLock(db,merchant);
  const old=(await db.query('SELECT * FROM promotion_requests WHERE merchant_id=$1 AND idempotency_key=$2',[merchant,d.idempotencyKey])).rows[0];if(old){if(old.request_hash!==digest)fail('IDEMPOTENCY_CONFLICT');return old.result;}
  try{promotionWindow(d.startsAt,d.expiresAt);}catch{fail('PROMOTION_REVIEW_REQUIRED');}
  if(d.destination)await guardPromotionDestination(db,merchant,d.destination);
  const members=await promotionProducts(db,merchant,d.productIds,d.destination?.tableId??null),products=d.bundle?[aggregateBundle(bundleSnapshot(members,d.bundle.unitMinor))]:members,provider=promotionProviderConfiguration(),configured=!!provider;
  const personal=d.audience==='daily'?null:await personalPromotionContext(db,merchant,d.audience,d.personal!);
  const context:PromotionAIContext=d.audience==='daily'?await dailyPromotionContext(db,merchant,d.productIds,dailyContextSchema.parse(d.daily)):personal!.context;
  if(d.bundle&&BigInt(d.bundle.unitMinor)>=BigInt(products[0].effectivePrice.amountMinor))fail('PROMOTION_REVIEW_REQUIRED');
  if(personal?.binding.excludedProductIds.some(id=>d.productIds.includes(id)))fail('PROMOTION_REVIEW_REQUIRED');
  if(products.some(p=>BigInt(d.minimumUnitMinor)>BigInt(p.bundle?.unitPrice.amountMinor??p.effectivePrice.amountMinor)))fail('PROMOTION_REVIEW_REQUIRED');
  if(d.requestedDiscountPercent!==undefined&&!products.some(p=>{try{return p.stock>0&&BigInt((p.bundle?.unitPrice??promotionPrice(p.basePrice,p.effectivePrice,d.requestedDiscountPercent!,d.maxDiscountPercent)).amountMinor)>=BigInt(d.minimumUnitMinor);}catch{return false;}}))fail('PROMOTION_REVIEW_REQUIRED');
  const row=(await db.query("INSERT INTO ai_generation_jobs(merchant_id,state,actor_id,input,products,blocker,provider_origin,provider_model) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[merchant,configured?'QUEUED':'CONFIGURATION_REQUIRED',actor,d,JSON.stringify(products),configured?null:'CONFIGURATION_REQUIRED',provider?new URL(provider.url).origin:null,provider?.model??null])).rows[0];
  await db.query('INSERT INTO promotion_job_contexts(merchant_id,job_id,audience,context,minimum_unit_minor) VALUES($1,$2,$3,$4,$5)',[merchant,row.id,d.audience,context,d.minimumUnitMinor]);
  if(d.destination)await db.query('INSERT INTO promotion_generation_destinations(merchant_id,job_id,destination) VALUES($1,$2,$3)',[merchant,row.id,d.destination]);
  if(personal)await savePersonalJobBinding(db,merchant,row.id,personal.binding);
  const result={job:promotionJobView(row)};await db.query('INSERT INTO promotion_requests(merchant_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4)',[merchant,d.idempotencyKey,digest,result]);await audit(db,merchant,actor,'promotion.generate',row.id);return result;
 }
 if(!match[1]||match[1]==='generate'||match[1].startsWith('jobs/')||match[1].startsWith('devices/'))fail('RESOURCE_NOT_FOUND',404);
 const action=method==='PATCH'&&!match[2]?'edit':method==='POST'?match[2]:null;if(!action)fail('RESOURCE_NOT_FOUND',404);
 if(action!=='publish')requireRole(role);
 const command=action==='derive'?{kind:'derive' as const,data:promotionDeriveSchema.parse(input)}:action==='edit'?{kind:'edit' as const,data:edit.parse(input)}:action==='publish'?{kind:'publish' as const,data:playlistPublishSchema.parse(input)}:{kind:'mutation' as const,data:mutation.parse(input)};
 const d=command.data,id=uuid.parse(match[1]),digest=hash(JSON.stringify([action,id,d]));await routingLock(db,merchant);
 const old=(await db.query('SELECT * FROM promotion_requests WHERE merchant_id=$1 AND idempotency_key=$2',[merchant,d.idempotencyKey])).rows[0];if(old){if(old.request_hash!==digest)fail('IDEMPOTENCY_CONFLICT');return old.result;}
 let c=(await db.query<CampaignRow>('SELECT * FROM promotion_campaigns WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id])).rows[0];if(!c)fail('RESOURCE_NOT_FOUND',404);if(c.version!==d.expectedVersion)fail('PROMOTION_VERSION_CONFLICT');
 if(command.kind==='derive'){
  const result=await derivePromotion(db,merchant,actor,c,command.data);
  await db.query('INSERT INTO promotion_requests(merchant_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4)',[merchant,d.idempotencyKey,digest,result]);await audit(db,merchant,actor,'promotion.derive.'+command.data.mode,id);return result;
 }
 // preview/edit are the refresh path: they rebuild the snapshot at the current price, so they must not be blocked by the stale-price gate they exist to clear.
 if(action!=='revoke'&&action!=='preview'&&action!=='edit'){const current=(await db.query('SELECT active_price_version_id FROM merchant_pricing WHERE merchant_id=$1',[merchant])).rows[0]?.active_price_version_id;if(current!==c.snapshot.priceVersion)fail('PROMOTION_REVIEW_REQUIRED');}
 const destination=await campaignPromotionDestination(db,merchant,c.id);if(destination&&action!=='revoke')await guardPromotionDestination(db,merchant,destination);
 const lineage=await campaignDerivation(db,merchant,c.id);if(lineage&&action!=='revoke')await guardDerivation(db,merchant,lineage.binding);
 if(action==='revoke'){
  if(c.state==='REVOKED')fail('PROMOTION_STATE_INVALID');
  await db.query("UPDATE promotion_campaigns SET state='REVOKED',version=version+1 WHERE merchant_id=$1 AND id=$2",[merchant,id]);
  const targets=(await db.query("SELECT * FROM promotion_targets WHERE merchant_id=$1 AND campaign_id=$2 AND state IN ('QUEUED','DELIVERED','RENDERED') FOR UPDATE",[merchant,id])).rows;for(const t of targets)await cancelPromotionTarget(db,merchant,t,'REVOKED');
  const playlistDevices=(await db.query("UPDATE promotion_playlist_targets SET state='REVOKED',failure='REVOKED' WHERE merchant_id=$1 AND campaign_id=$2 AND state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') RETURNING target_device_id",[merchant,id])).rows;
  for(const device of playlistDevices)await reconcilePromotionPlaylist(db,merchant,device.target_device_id,'0');
 }else{
  if(!['DRAFT','APPROVED'].includes(c.state)||Date.now()>=new Date(c.expires_at).getTime())fail('PROMOTION_STATE_INVALID');
  const active=(await db.query("SELECT 1 FROM promotion_targets WHERE merchant_id=$1 AND campaign_id=$2 AND state IN ('QUEUED','DELIVERED','RENDERED') UNION ALL SELECT 1 FROM promotion_playlist_targets WHERE merchant_id=$1 AND campaign_id=$2 LIMIT 1",[merchant,id])).rowCount;if(active)fail('PROMOTION_STATE_INVALID');
  if(action==='edit'||action==='preview'){
   const patch:Partial<z.infer<typeof edit>>=action==='edit'?edit.parse(d):{},headline=patch.headline??c.headline,copy=patch.copy??c.copy,percent=patch.discountPercent??c.discount_percent,start=patch.startsAt??new Date(c.starts_at).toISOString(),end=patch.expiresAt??new Date(c.expires_at).toISOString();
   let snapshot=await campaignSnapshot(db,merchant,c,lineage?.binding.placement.tableId??destination?.tableId??null);if(patch.bundleUnitMinor){if(!snapshot.bundle)fail('INVALID_REQUEST',422);snapshot=aggregateBundle(bundleSnapshot(snapshot.bundle.members,patch.bundleUnitMinor));}let price;try{promotionWindow(start,end);price=campaignPrice(snapshot,percent,c.max_discount_percent,lineage);}catch{fail('PROMOTION_REVIEW_REQUIRED');}
   await campaignFloor(db,merchant,c.id,price);
   const asset=await renderPromotionAsset(db,merchant,snapshot.imageUrl,headline,copy,percent,price,undefined,snapshot.bundle);
   await db.query("UPDATE promotion_campaigns SET headline=$3,copy=$4,discount_percent=$5,starts_at=$6,expires_at=$7,snapshot=$8,asset_token=$9,asset_blocker=$10,state='DRAFT',approved_version=NULL,approved_by=NULL,version=version+1 WHERE merchant_id=$1 AND id=$2",[merchant,id,headline,copy,percent,start,end,snapshot,asset.token,asset.blocker]);
  }else{
   const snapshot=await campaignSnapshot(db,merchant,c,lineage?.binding.placement.tableId??destination?.tableId??null);if(!samePromotionSnapshot(c.snapshot,snapshot))fail('PROMOTION_REVIEW_REQUIRED');try{promotionWindow(new Date(c.starts_at).toISOString(),new Date(c.expires_at).toISOString());campaignPrice(snapshot,c.discount_percent,c.max_discount_percent,lineage);}catch{fail('PROMOTION_REVIEW_REQUIRED');}
   await campaignFloor(db,merchant,c.id,campaignPrice(snapshot,c.discount_percent,c.max_discount_percent,lineage));await guardPersonalJob(db,merchant,c.job_id);
   await validatePromotionAssetFresh(db,merchant,c.asset_token,snapshot.imageUrl,snapshot.bundle);
   if(action==='approve'){
    if(c.state!=='DRAFT')fail('PROMOTION_STATE_INVALID');const version=c.version+1;
    await db.query('INSERT INTO promotion_revisions(merchant_id,campaign_id,version,content,approved_by) VALUES($1,$2,$3,$4,$5)',[merchant,id,version,{productId:c.product_id,headline:c.headline,copy:c.copy,discountPercent:c.discount_percent,snapshot:c.snapshot,startsAt:c.starts_at,expiresAt:c.expires_at,provenance:c.provenance},actor]);
    await db.query("UPDATE promotion_campaigns SET state='APPROVED',version=$3,approved_version=$3,approved_by=$4 WHERE merchant_id=$1 AND id=$2",[merchant,id,version,actor]);
   }else if(command.kind==='publish'){
    if(c.state!=='APPROVED'||c.approved_version===null)fail('PROMOTION_STATE_INVALID');
    await guardPersonalJob(db,merchant,c.job_id);const binding=await personalCampaignBinding(db,merchant,c.job_id);await publishCampaignPlaylist(db,merchant,c,command.data,binding??undefined);
    await db.query('UPDATE promotion_campaigns SET version=version+1 WHERE merchant_id=$1 AND id=$2',[merchant,id]);
   }
  }
 }
 c=(await db.query<CampaignRow>('SELECT * FROM promotion_campaigns WHERE merchant_id=$1 AND id=$2',[merchant,id])).rows[0];const campaign=await promotionCampaignView(db,merchant,c),result={campaign};
 await db.query('INSERT INTO promotion_requests(merchant_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4)',[merchant,d.idempotencyKey,digest,result]);await audit(db,merchant,actor,'promotion.'+action,id);return result;
}
async function campaignFloor(db:pg.PoolClient,merchant:string,campaign:string,price:{amountMinor:string}){
 const scope=(await db.query('SELECT minimum_unit_minor::text AS floor FROM promotion_scopes WHERE merchant_id=$1 AND campaign_id=$2',[merchant,campaign])).rows[0];
 if(!scope||BigInt(price.amountMinor)<BigInt(scope.floor))fail('PROMOTION_REVIEW_REQUIRED');
}
