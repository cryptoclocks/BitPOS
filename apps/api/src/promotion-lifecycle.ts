import type pg from 'pg';
import type {PromotionNotice} from '../../../packages/contracts/src/index';
import {promotionPrice} from '../../../packages/domain/src/promotions';
import {promotionImage} from './promotion-assets';
import {streamEvent} from './orders';
import {effectiveCatalog} from './catalog';
export async function cancelPromotionTarget(db:pg.PoolClient,merchant:string,t:Record<string,any>,state:'REVOKED'|'EXPIRED'|'FAILED',failure:string|null=null){
 await db.query('UPDATE promotion_targets SET state=$3,failure=$4 WHERE merchant_id=$1 AND id=$2',[merchant,t.id,state,failure]);
 if(!t.last_event_id||t.cancel_event_id)return;
 const d=(await db.query('SELECT d.*,s.kind,s.screen_generation FROM devices d JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id WHERE d.merchant_id=$1 AND d.id=$2',[merchant,t.target_device_id])).rows[0];
 // A matching original fence only. Never clear a later guest/payment screen.
 if(!d||d.revoked_at||d.kind!=='idle'||String(d.assignment_generation)!==String(t.assignment_generation)||String(d.auth_generation)!==String(t.auth_generation)||String(d.screen_generation)!==String(t.screen_generation))return;
 const notice=await promotionNotice(db,merchant,t,'CANCELED');const event=await streamEvent(db,merchant,t.target_device_id,String(t.assignment_generation),String(t.screen_generation),'PROMOTION',notice,undefined,new Date().toISOString(),String(t.auth_generation));
 await db.query('UPDATE promotion_targets SET cancel_event_id=$3 WHERE merchant_id=$1 AND id=$2',[merchant,t.id,event.eventId]);
}
export async function promotionNotice(db:pg.PoolClient,merchant:string,t:Record<string,any>,state:'READY'|'CANCELED'):Promise<PromotionNotice>{
 const r=(await db.query('SELECT content FROM promotion_revisions WHERE merchant_id=$1 AND campaign_id=$2 AND version=$3',[merchant,t.campaign_id,t.campaign_version])).rows[0].content;
 return {targetId:t.id,campaignId:t.campaign_id,productId:r.productId,headline:r.headline,copy:r.copy,discountPercent:r.discountPercent,unitPrice:promotionPrice(r.snapshot.basePrice,r.snapshot.effectivePrice,r.discountPercent,r.discountPercent),basePrice:r.snapshot.basePrice,expiresAt:new Date(t.expires_at).toISOString(),image:await promotionImage(db,merchant,t.asset_token),menuUrl:t.menu_url,state};
}
export async function reconcilePromotions(db:pg.PoolClient,merchant:string,device:string,connection:string){
 const targets=(await db.query(`SELECT t.*,c.state AS campaign_state,c.starts_at,c.expires_at AS campaign_expires,e.session_id AS bound_session,e.order_id AS bound_order FROM promotion_targets t JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id LEFT JOIN scoped_offer_eligibility e ON e.merchant_id=t.merchant_id AND e.target_id=t.id WHERE t.merchant_id=$1 AND t.target_device_id=$2 AND t.state IN ('QUEUED','DELIVERED','RENDERED') ORDER BY t.created_at,t.id FOR UPDATE OF t`,[merchant,device])).rows;if(!targets.length)return;
 const d=(await db.query(`SELECT d.*,s.kind,s.screen_generation::text,p.connected_until>clock_timestamp() AS online,p.connection_generation::text,c.capabilities,c.connection_generation::text AS capability_connection FROM devices d JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id LEFT JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id LEFT JOIN device_capabilities c ON c.merchant_id=d.merchant_id AND c.device_id=d.id WHERE d.merchant_id=$1 AND d.id=$2`,[merchant,device])).rows[0];
 for(const t of targets){
  if(t.campaign_state==='REVOKED'){await cancelPromotionTarget(db,merchant,t,'REVOKED');continue;}
  if(Date.now()>=Math.min(new Date(t.expires_at).getTime(),new Date(t.campaign_expires).getTime())){await cancelPromotionTarget(db,merchant,t,'EXPIRED');continue;}
  if(!(await db.query('SELECT bitpos.promotion_binding_current($1::uuid,$2::uuid) AS current',[merchant,t.id])).rows[0].current){await cancelPromotionTarget(db,merchant,t,'FAILED','PROMOTION_TARGET_CHANGED');continue;}
  // Redemption owns a different cart/order generation. Preserve eligibility and
  // frozen bills; never replay the promotion over that acquired financial flow.
  if(t.bound_session)continue;
  if(d.screen_generation!==String(t.screen_generation)||String(d.pickup_guest_generation)!==String(t.guest_generation)){await cancelPromotionTarget(db,merchant,t,'FAILED','PROMOTION_TARGET_CHANGED');continue;}
  const revision=(await db.query('SELECT content FROM promotion_revisions WHERE merchant_id=$1 AND campaign_id=$2 AND version=$3',[merchant,t.campaign_id,t.campaign_version])).rows[0].content;
  const menu=await effectiveCatalog(db,merchant),product=menu.products.find(p=>p.id===revision.productId),approved=revision.snapshot;
  if(!product?.basePrice||!product.unitPrice||product.available<1||menu.priceVersion!==approved.priceVersion||product.basePrice.amountMinor!==approved.basePrice.amountMinor||product.unitPrice.amountMinor!==approved.effectivePrice.amountMinor||product.imageUrl!==approved.imageUrl){await cancelPromotionTarget(db,merchant,t,'FAILED','PROMOTION_REVIEW_REQUIRED');continue;}
  if(!d.online||d.connection_generation!==connection||d.kind!=='idle'||new Date(t.starts_at).getTime()>Date.now())continue;
  if(d.capability_connection!==connection||!d.capabilities?.includes('promotion_v1'))continue;
  if((await db.query("SELECT 1 FROM pickup_notifications WHERE merchant_id=$1 AND target_device_id=$2 AND state IN ('PENDING','DELIVERED','RENDERED') AND expires_at>clock_timestamp() AND bitpos.pickup_binding_current(merchant_id,id) LIMIT 1",[merchant,device])).rowCount)continue;
  if(t.last_event_id&&String(t.last_connection_generation)===connection)continue;
  const event=await streamEvent(db,merchant,device,String(t.assignment_generation),String(t.screen_generation),'PROMOTION',await promotionNotice(db,merchant,t,'READY'),undefined,new Date().toISOString(),String(t.auth_generation));
  await db.query("UPDATE promotion_targets SET state='DELIVERED',last_event_id=$3,last_connection_generation=$4 WHERE merchant_id=$1 AND id=$2",[merchant,t.id,event.eventId,connection]);
 }
}
export async function promotionRendered(db:pg.PoolClient,merchant:string,device:string,eventId:string,receivedAt:string){
 await db.query(`UPDATE promotion_targets t SET state='RENDERED',rendered_at=coalesce(t.rendered_at,$4::timestamptz) FROM outbox_events e WHERE t.merchant_id=$1 AND t.target_device_id=$2 AND t.last_event_id=$3 AND e.merchant_id=t.merchant_id AND e.id=t.last_event_id AND e.type='PROMOTION' AND e.payload->'payload'->>'state'='READY' AND t.state IN ('DELIVERED','RENDERED') AND t.expires_at>clock_timestamp() AND bitpos.promotion_binding_current(t.merchant_id,t.id)`,[merchant,device,eventId,receivedAt]);
}
