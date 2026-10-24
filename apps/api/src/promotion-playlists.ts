import {campaignPromotionDestination,guardPromotionDestination} from './promotion-destination';
import type pg from 'pg';
import {z} from 'zod';
import type {DevicePromotionPlaylist,PlaylistPromotion,PlaylistCampaignTarget} from '../../../packages/contracts/src/daily-promotions';
import {hash} from '../../../packages/domain/src/index';
import {promotionPrice} from '../../../packages/domain/src/promotions';
import {customerOrigin} from './config';
import {promotionImage} from './promotion-assets';
import {effectiveCatalog} from './catalog';
import {streamEvent} from './orders';
import {fail,uuid,positive} from './authority';
import type {CampaignRow} from './promotions';
import {campaignDerivation,guardDerivation} from './promotion-derivation';
export const playlistPublishSchema=z.object({expectedVersion:z.number().int().positive(),idempotencyKey:z.string().min(1).max(128),confirmTargets:z.literal(true),targets:z.array(z.object({deviceId:uuid,assignmentGeneration:positive,authGeneration:positive,screenGeneration:positive}).strict()).min(1).max(100).refine(v=>new Set(v.map(t=>t.deviceId)).size===v.length)}).strict();
export async function playlistTargetsView(db:pg.PoolClient,merchant:string,campaign:string):Promise<PlaylistCampaignTarget[]>{
 return (await db.query(`SELECT id,campaign_id AS "campaignId",campaign_version AS "campaignVersion",target_device_id AS "deviceId",audience,state,failure,rendered_at AS "renderedAt" FROM promotion_playlist_targets WHERE merchant_id=$1 AND campaign_id=$2 ORDER BY created_at,id`,[merchant,campaign])).rows.map(r=>({...r,renderedAt:r.renderedAt?new Date(r.renderedAt).toISOString():null}));
}
export async function publishCampaignPlaylist(db:pg.PoolClient,merchant:string,c:CampaignRow,input:z.infer<typeof playlistPublishSchema>,binding?:{targetDeviceId:string;assignmentGeneration:string;authGeneration:string;tableId:string;occupancyId:string;occupancyGeneration:string;recipientId:string}){
 const scope=(await db.query('SELECT audience FROM promotion_scopes WHERE merchant_id=$1 AND campaign_id=$2',[merchant,c.id])).rows[0];
 if(!scope||c.state!=='APPROVED'||c.approved_version===null)fail('PROMOTION_STATE_INVALID');
 const devices=(await db.query('SELECT id FROM devices WHERE merchant_id=$1 AND revoked_at IS NULL ORDER BY id',[merchant])).rows;
 const lineage=await campaignDerivation(db,merchant,c.id);if(lineage)await guardDerivation(db,merchant,lineage.binding);
 const destination=await campaignPromotionDestination(db,merchant,c.id);if(destination)await guardPromotionDestination(db,merchant,destination);
 const required=destination?[destination.deviceId]:lineage?lineage.binding.placement.deviceIds:scope.audience==='daily'?devices.map(d=>d.id):binding?[binding.targetDeviceId]:[];
 if(!required.length||required.length!==input.targets.length||required.some(id=>!input.targets.some(t=>t.deviceId===id)))fail('PROMOTION_TARGET_CHANGED');
 for(const target of input.targets){
  const d=await deviceState(db,merchant,target.deviceId);
  if(d.revoked_at||String(d.assignment_generation)!==target.assignmentGeneration||String(d.auth_generation)!==target.authGeneration||d.screen_generation!==target.screenGeneration)fail('PROMOTION_TARGET_CHANGED');
  if(binding&&(d.table_id!==binding.tableId||target.assignmentGeneration!==binding.assignmentGeneration||target.authGeneration!==binding.authGeneration||d.occupancy_generation!==binding.occupancyGeneration))fail('PROMOTION_TARGET_CHANGED');
  const original=lineage?.binding.targets.find(t=>t.deviceId===target.deviceId);
  if(original&&(target.assignmentGeneration!==original.assignmentGeneration||target.authGeneration!==original.authGeneration))fail('PROMOTION_TARGET_CHANGED');
  if(lineage?.binding.placement.kind==='table'&&(d.table_id!==lineage.binding.placement.tableId||d.occupancy_generation!==lineage.binding.occupancyGeneration))fail('PROMOTION_TARGET_CHANGED');
  const audience=scope.audience==='daily'?'daily':'personal',expiry=new Date(Math.min(c.expires_at.getTime(),audience==='personal'?Date.now()+600000:c.expires_at.getTime())).toISOString();
  const state=!d.online?'DEFERRED_OFFLINE':!d.capable?'UNSUPPORTED':d.kind!=='idle'||d.pickup_busy?'DEFERRED_BUSY':'QUEUED';
  await db.query('INSERT INTO promotion_playlist_targets(merchant_id,campaign_id,campaign_version,audience,target_device_id,assignment_generation,auth_generation,table_id,occupancy_id,occupancy_generation,recipient_id,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[merchant,c.id,c.approved_version,audience,target.deviceId,target.assignmentGeneration,target.authGeneration,binding?.tableId??lineage?.binding.placement.tableId??destination?.tableId??null,binding?.occupancyId??null,binding?.occupancyGeneration??null,binding?.recipientId??null,state,expiry]);
 }
 // Daily table overrides retain their public baseline; personal or explicit shared replacements consume original destinations.
 if(lineage&&(lineage.binding.placement.kind==='campaign_devices'||scope.audience!=='daily'))await db.query("UPDATE promotion_playlist_targets SET state='REVOKED',failure='REPLACED' WHERE merchant_id=$1 AND id=ANY($2::uuid[])",[merchant,lineage.binding.targets.map(t=>t.targetId)]);
 for(const target of input.targets){const d=await deviceState(db,merchant,target.deviceId);await reconcilePromotionPlaylist(db,merchant,target.deviceId,d.connection_generation??'0');}
}
async function deviceState(db:pg.PoolClient,merchant:string,device:string){
 const row=(await db.query(`SELECT d.*,s.kind,s.screen_generation::text,p.connection_generation::text,coalesce(p.connected_until>clock_timestamp(),false) AS online,
 coalesce(cap.connection_generation=p.connection_generation AND 'promotion_playlist_v1'=ANY(cap.capabilities),false) AS capable,coalesce(cap.connection_generation=p.connection_generation AND 'promotion_playlist_v2'=ANY(cap.capabilities),false) AS extended_playlist,coalesce(cap.connection_generation=p.connection_generation AND 'promotion_bundle_v1'=ANY(cap.capabilities),false) AS bundle_capable,t.occupancy_generation::text,t.retired_at,
 e.entry_token,EXISTS(SELECT 1 FROM pickup_notifications n WHERE n.merchant_id=d.merchant_id AND n.target_device_id=d.id AND n.state IN ('PENDING','DELIVERED','RENDERED') AND n.expires_at>clock_timestamp() AND bitpos.pickup_binding_current(n.merchant_id,n.id)) AS pickup_busy
 FROM devices d JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
 LEFT JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id
 LEFT JOIN device_capabilities cap ON cap.merchant_id=d.merchant_id AND cap.device_id=d.id
 LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
 LEFT JOIN table_entries e ON e.merchant_id=d.merchant_id AND e.device_id=d.id AND e.assignment_generation=d.assignment_generation AND e.auth_generation=d.auth_generation AND e.table_id=d.table_id
 WHERE d.merchant_id=$1 AND d.id=$2`,[merchant,device])).rows[0];if(!row)fail('RESOURCE_NOT_FOUND',404);return row;
}
/** Caller holds the routing mutex; this creates only nonfinancial device playlist state. */
export async function currentPromotionPlaylist(db:pg.PoolClient,merchant:string,device:string,force=false):Promise<DevicePromotionPlaylist>{
 await db.query('INSERT INTO device_promotion_playlist_state(merchant_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[merchant,device]);
 const state=(await db.query('SELECT * FROM device_promotion_playlist_state WHERE merchant_id=$1 AND device_id=$2 FOR UPDATE',[merchant,device])).rows[0],d=await deviceState(db,merchant,device);
 const targets=(await db.query(`SELECT t.*,c.state AS campaign_state,c.starts_at,c.expires_at AS campaign_expires,c.asset_token,r.content,scope.minimum_unit_minor::text,
 bitpos.playlist_target_current(t.merchant_id,t.id) AS binding_current,coalesce(x.binding->'placement'->>'kind'='table',false) AS table_local
 FROM promotion_playlist_targets t JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id
 JOIN promotion_revisions r ON r.merchant_id=t.merchant_id AND r.campaign_id=t.campaign_id AND r.version=t.campaign_version
 JOIN promotion_scopes scope ON scope.merchant_id=t.merchant_id AND scope.campaign_id=t.campaign_id
 LEFT JOIN promotion_scope_placements x ON x.merchant_id=t.merchant_id AND x.campaign_id=t.campaign_id
 WHERE t.merchant_id=$1 AND t.target_device_id=$2 AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') ORDER BY coalesce(x.binding->'placement'->>'kind'='table',false) ASC,t.created_at ASC,t.id`,[merchant,device])).rows;
 const menu=await effectiveCatalog(db,merchant,d.table_id),publicMenu=d.table_id?await effectiveCatalog(db,merchant):menu,items:PlaylistPromotion[]=[],localProducts=new Set<string>();let daily=0,personal=0;
 for(const t of targets){
  const expiry=Math.min(new Date(t.expires_at).getTime(),new Date(t.campaign_expires).getTime());
  let terminal:string|null=t.campaign_state==='REVOKED'?'REVOKED':Date.now()>=expiry?'EXPIRED':!t.binding_current?'TARGET_CHANGED':null;
  // A better table price is selection, not permanent invalidation of shared public authority.
  const authority=t.audience==='daily'&&!t.table_local?publicMenu:menu;
  const r=t.content,product=authority.products.find(p=>p.id===r.productId);let price;
  if(!terminal&&r.snapshot.bundle){price=r.snapshot.bundle.unitPrice;}
  else if(!terminal){try{price=promotionPrice(r.snapshot.basePrice,r.snapshot.basePrice,r.discountPercent,r.discountPercent);}catch{terminal='TARGET_CHANGED';}
   if(!product?.basePrice||!product.unitPrice||product.available<1||authority.priceVersion!==r.snapshot.priceVersion||product.basePrice.amountMinor!==r.snapshot.basePrice.amountMinor||product.imageUrl!==r.snapshot.imageUrl||price&&BigInt(price.amountMinor)>BigInt(product.unitPrice.amountMinor)||price&&BigInt(price.amountMinor)<BigInt(t.minimum_unit_minor))terminal='TARGET_CHANGED';
  }
  if(terminal){await db.query('UPDATE promotion_playlist_targets SET state=$3,failure=$4 WHERE merchant_id=$1 AND id=$2',[merchant,t.id,terminal,terminal==='TARGET_CHANGED'?'PROMOTION_REVIEW_REQUIRED':null]);continue;}
  if(r.snapshot.bundle&&!d.bundle_capable){await db.query("UPDATE promotion_playlist_targets SET state='UNSUPPORTED',failure='BUNDLE_FIRMWARE_REQUIRED' WHERE merchant_id=$1 AND id=$2",[merchant,t.id]);continue;}
  const busy=d.kind!=='idle'||d.pickup_busy;
  const next=!d.online?'DEFERRED_OFFLINE':!d.capable?'UNSUPPORTED':busy?'DEFERRED_BUSY':t.state==='RENDERED'?'RENDERED':'QUEUED';
  if(next!==t.state&&!(next==='QUEUED'&&t.state==='DELIVERED'))await db.query('UPDATE promotion_playlist_targets SET state=$3 WHERE merchant_id=$1 AND id=$2',[merchant,t.id,next]);
  if(new Date(t.starts_at).getTime()>Date.now()||!price)continue;
  const localPrice=r.snapshot.bundle?undefined:menu.products.find(p=>p.id===r.productId)?.unitPrice;
  if(t.audience==='daily'&&!t.table_local&&(localProducts.has(r.productId)||localPrice&&BigInt(price.amountMinor)>BigInt(localPrice.amountMinor)))continue;
  if(t.audience==='daily'&&daily>=(d.extended_playlist?3:2)||t.audience==='personal'&&personal>=1)continue;
  if(t.audience==='daily'){daily++;if(t.table_local)localProducts.add(r.productId);}else personal++;
  const menuUrl=d.entry_token?customerOrigin+'/table/'+d.entry_token:null;
  const startsAt=new Date(t.audience==='personal'?Math.max(new Date(t.starts_at).getTime(),new Date(t.created_at).getTime()):new Date(t.starts_at).getTime()).toISOString();
  items.push({targetId:t.id,campaignId:t.campaign_id,campaignVersion:t.campaign_version,audience:t.audience,productId:r.productId,headline:r.headline,copy:r.copy,unitPrice:price,basePrice:r.snapshot.basePrice,...(r.snapshot.bundle?{bundle:true,discountLabel:r.snapshot.bundle.discountLabel}:{}),discountPercent:r.discountPercent,startsAt,expiresAt:new Date(expiry).toISOString(),image:await promotionImage(db,merchant,t.asset_token),menuUrl});
 }
 items.sort((a,b)=>a.audience===b.audience?0:a.audience==='daily'?-1:1);
 const fence={assignment:String(d.assignment_generation),auth:String(d.auth_generation),screen:d.screen_generation,table:d.table_id,occupancy:d.occupancy_generation??null,items};const digest=hash(JSON.stringify(fence));
 const changed=force||state.content_hash!==digest,generation=changed?String(BigInt(state.generation)+1n):String(state.generation);
 const playlist:DevicePromotionPlaylist={generation,occupancyGeneration:d.table_id&&d.retired_at===null?d.occupancy_generation:null,tableId:d.table_id,state:'CURRENT',items};
 if(changed)await db.query('UPDATE device_promotion_playlist_state SET generation=$3,content_hash=$4,content=$5,last_event_id=NULL,last_connection_generation=NULL WHERE merchant_id=$1 AND device_id=$2',[merchant,device,generation,digest,playlist]);
 return playlist;
}
export async function reconcilePromotionPlaylist(db:pg.PoolClient,merchant:string,device:string,connection:string){
 const playlist=await currentPromotionPlaylist(db,merchant,device),d=await deviceState(db,merchant,device);
 if(!d.online||!d.capable||d.kind!=='idle'||d.pickup_busy||d.connection_generation!==connection)return;
 const state=(await db.query('SELECT * FROM device_promotion_playlist_state WHERE merchant_id=$1 AND device_id=$2',[merchant,device])).rows[0];
 if(state.last_event_id&&String(state.last_connection_generation)===connection)return;
 const event=await streamEvent(db,merchant,device,String(d.assignment_generation),d.screen_generation,'PROMOTION_PLAYLIST',playlist,undefined,new Date().toISOString(),String(d.auth_generation));
 await db.query('INSERT INTO promotion_playlist_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[merchant,event.eventId,device,playlist.generation,d.auth_generation,d.assignment_generation,d.screen_generation,playlist.tableId,playlist.occupancyGeneration,playlist.items.map(p=>p.targetId)]);
 await db.query('UPDATE device_promotion_playlist_state SET last_event_id=$3,last_connection_generation=$4 WHERE merchant_id=$1 AND device_id=$2',[merchant,device,event.eventId,connection]);
 await db.query("UPDATE promotion_playlist_targets SET state='DELIVERED',last_event_id=$3,last_connection_generation=$4 WHERE merchant_id=$1 AND id=ANY($2::uuid[]) AND state<>'RENDERED'",[merchant,playlist.items.map(p=>p.targetId),event.eventId,connection]);
}
export async function promotionPlaylistRendered(db:pg.PoolClient,merchant:string,device:string,eventId:string,receivedAt:string){
 await db.query(`UPDATE promotion_playlist_targets t SET state='RENDERED',rendered_at=coalesce(t.rendered_at,$4::timestamptz)
 FROM device_promotion_playlist_state s
 JOIN device_screen_state screen ON screen.merchant_id=s.merchant_id AND screen.device_id=s.device_id
 JOIN outbox_events event ON event.merchant_id=s.merchant_id AND event.target_device_id=s.device_id AND event.id=$3
 LEFT JOIN promotion_playlist_events fence ON fence.merchant_id=event.merchant_id AND fence.event_id=event.id AND fence.device_id=s.device_id
 WHERE s.merchant_id=$1 AND s.device_id=$2 AND t.merchant_id=s.merchant_id AND t.target_device_id=s.device_id
 AND screen.kind='idle' AND event.order_id IS NULL AND event.screen_generation=screen.screen_generation
 AND ((fence.generation=s.generation AND t.id=ANY(fence.target_ids)) OR
      (event.type IN ('CONFIG','SNAPSHOT','CART') AND event.payload->'payload'->'promotionPlaylist'=s.content
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.content->'items') item WHERE item->>'targetId'=t.id::text)))
 AND t.state IN ('DELIVERED','RENDERED') AND t.expires_at>clock_timestamp() AND bitpos.playlist_target_current(t.merchant_id,t.id)`,[merchant,device,eventId,receivedAt]);
}
