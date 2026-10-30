// Meta hackathon work (2026-10-26..11-04). See meta-hackathon/PROVENANCE.md.
// Kitchen stages for paid Meta orders (migration 316): received → preparing → ready, then the order's own hand-over.
// Only a paid order that is not handed over moves; READY returns the customer's Messenger id once (consented,
// not revoked links only) so the caller can send "your order is ready" after the transaction commits.
import type {MetaDb} from './identity';

export type KitchenStage='PREPARING'|'READY';
export class KitchenError extends Error {constructor(readonly code:'NOT_FOUND'|'NOT_PAID'|'HANDED_OVER'|'NOT_CHECKED_IN'){super(code);}}

/** Current stages of the shop's Meta orders (orders without a row are "received"). */
export async function kitchenStages(db:MetaDb,merchantId:string):Promise<Map<string,KitchenStage>>{
 const rows=(await db.tenant(merchantId,c=>c.query<{order_id:string;stage:KitchenStage}>("SELECT order_id,stage FROM meta_order_kitchen WHERE updated_at>clock_timestamp()-interval '2 days'"))).rows;
 return new Map(rows.map(r=>[r.order_id,r.stage]));
}

export async function setKitchenStage(db:MetaDb,merchantId:string,userId:string,orderId:string,stage:KitchenStage):Promise<{notify:{psid:string;code:string}|null}>{
 return db.tenant(merchantId,async c=>{
  // held: a booking's pre-order whose customer has not checked in yet; the kitchen does not start it.
  const o=(await c.query<{kind:'tap'|'agent'|'cart';paid:boolean;handed:boolean;link_id:string|null;held:boolean|null}>(
   `SELECT 'tap' AS kind,status='PAID' AS paid,handed_over_at IS NOT NULL AS handed,link_id,false AS held FROM meta_tap_orders WHERE id=$1
    UNION ALL SELECT 'agent',o.status='CONFIRMED',o.handed_over_at IS NOT NULL,o.link_id,(SELECT r.status='HELD' FROM meta_table_reservations r WHERE r.merchant_id=o.merchant_id AND r.id=o.reservation_id) FROM meta_agent_orders o WHERE o.id=$1
    UNION ALL SELECT 'cart',o.status='PAID',o.handed_over_at IS NOT NULL,o.link_id,(SELECT r.status='HELD' FROM meta_table_reservations r WHERE r.merchant_id=o.merchant_id AND r.id=o.reservation_id) FROM meta_cart_orders o WHERE o.id=$1`,[orderId])).rows[0];
  if(!o)throw new KitchenError('NOT_FOUND');
  if(!o.paid)throw new KitchenError('NOT_PAID');
  if(o.handed)throw new KitchenError('HANDED_OVER');
  if(o.held)throw new KitchenError('NOT_CHECKED_IN');
  await c.query(`INSERT INTO meta_order_kitchen(merchant_id,order_id,order_kind,stage,updated_by) VALUES(current_setting('bitpos.merchant')::uuid,$1,$2,$3,$4)
   ON CONFLICT(merchant_id,order_id) DO UPDATE SET stage=EXCLUDED.stage,updated_at=clock_timestamp(),updated_by=EXCLUDED.updated_by`,[orderId,o.kind,stage,userId]);
  if(stage!=='READY'||!o.link_id)return {notify:null};
  // Claim the one ready notice; a second READY (or a retry) finds it already taken.
  const claimed=(await c.query("UPDATE meta_order_kitchen SET ready_notified_at=clock_timestamp() WHERE order_id=$1 AND ready_notified_at IS NULL RETURNING order_id",[orderId])).rowCount;
  if(!claimed)return {notify:null};
  const psid=(await c.query<{psid:string}>('SELECT psid FROM meta_customer_links WHERE id=$1 AND revoked_at IS NULL',[o.link_id])).rows[0]?.psid;
  return {notify:psid?{psid,code:orderId.replace(/-/g,'').slice(0,4).toUpperCase()}:null};
 });
}
