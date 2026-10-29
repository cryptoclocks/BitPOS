import type pg from 'pg';
import {z} from 'zod';
import {hash} from '../../../packages/domain/src/index';
import type {FulfillmentView,PickupNotice} from '../../../packages/contracts/src/index';
import {audit} from './db';
import {fail,routingLock,uuid,positive} from './authority';
import {streamEvent} from './orders';
const transition=z.object({status:z.enum(['PREPARING','READY','COLLECTED']),expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().min(1).max(128)}).strict();
const resend=z.object({expectedVersion:z.number().int().nonnegative(),idempotencyKey:z.string().min(1).max(128),targetDeviceId:uuid,assignmentGeneration:positive,confirmTarget:z.literal(true)}).strict();
type NoticeRow={id:string;order_id:string;target_device_id:string;assignment_generation:string;auth_generation:string;serving_table_id:string|null;visit_id:string|null;state:string;effect_id:string;expires_at:Date;sound_consumed_at:Date|null;last_event_id:string|null;last_screen_generation:string|null;last_connection_generation:string|null;cancel_event_id:string|null};
export async function fulfillmentViews(db:pg.PoolClient,merchant:string,ids:string[]):Promise<Map<string,FulfillmentView>>{
 if(!ids.length)return new Map();
 const rows=(await db.query(`SELECT o.id,coalesce(f.status,'RECEIVED') AS status,coalesce(f.version,0) AS version,
 CASE WHEN n.id IS NULL THEN NULL ELSE jsonb_build_object('id',n.id,'state',CASE WHEN n.state IN ('PENDING','DELIVERED','RENDERED','UNSUPPORTED') AND n.expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE n.state END,'targetDeviceId',n.target_device_id,'assignmentGeneration',n.assignment_generation::text,'expiresAt',n.expires_at) END AS notification,
 CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('deviceId',d.id,'label',d.label,'assignmentGeneration',d.assignment_generation::text,'tableLabel',t.label) END AS target
 FROM orders o LEFT JOIN order_fulfillment f ON f.merchant_id=o.merchant_id AND f.order_id=o.id
 LEFT JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id
 LEFT JOIN LATERAL(SELECT * FROM pickup_notifications p WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id ORDER BY p.created_at DESC,p.id DESC LIMIT 1)n ON true
 LEFT JOIN devices d ON d.merchant_id=o.merchant_id AND d.id=coalesce(n.target_device_id,a.target_device_id)
 LEFT JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id
 WHERE o.merchant_id=$1 AND o.id=ANY($2::uuid[])`,[merchant,ids])).rows;
 return new Map(rows.map(r=>[r.id,{status:r.status,version:r.version,notification:r.notification,target:r.target}]));
}
function payload(n:NoticeRow,sound:boolean,state:'READY'|'CANCELED'):PickupNotice{return {notificationId:n.id,orderId:n.order_id,pickupCode:n.order_id.slice(0,8).toUpperCase(),expiresAt:new Date(n.expires_at).toISOString(),effectId:n.effect_id,sound,state};}
async function cancelNotice(db:pg.PoolClient,merchant:string,n:NoticeRow,state='CANCELED'){
 await db.query('UPDATE pickup_notifications SET state=$3 WHERE merchant_id=$1 AND id=$2',[merchant,n.id,state]);
 if(n.last_event_id&&!n.cancel_event_id){
  const s=(await db.query("SELECT s.screen_generation::text,d.assignment_generation::text,d.auth_generation::text,d.revoked_at,s.kind FROM device_screen_state s JOIN devices d ON d.merchant_id=s.merchant_id AND d.id=s.device_id WHERE s.merchant_id=$1 AND s.device_id=$2",[merchant,n.target_device_id])).rows[0];
  // Never retarget a tombstone through a new assignment/auth identity. A matching
  // cancellation may clear only this notice, not whichever guest now owns it.
  if(s?.kind==='idle'&&!s.revoked_at&&s.assignment_generation===String(n.assignment_generation)&&s.auth_generation===String(n.auth_generation)){
   const event=await streamEvent(db,merchant,n.target_device_id,s.assignment_generation,s.screen_generation,'PICKUP_READY',payload(n,false,'CANCELED'));
   await db.query('UPDATE pickup_notifications SET cancel_event_id=$3 WHERE merchant_id=$1 AND id=$2',[merchant,n.id,event.eventId]);
  }
 }
}
export async function invalidateTablePickups(db:pg.PoolClient,merchant:string,table:string){
 const notices=(await db.query<NoticeRow>("SELECT * FROM pickup_notifications WHERE merchant_id=$1 AND serving_table_id=$2 AND state IN ('PENDING','DELIVERED','RENDERED','UNSUPPORTED','TARGET_CHANGED') ORDER BY id FOR UPDATE",[merchant,table])).rows;
 for(const notice of notices)await cancelNotice(db,merchant,notice);
}
export async function fulfillmentRequest(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:string,retry:boolean,input:unknown){
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 const data=retry?resend.parse(input):transition.parse(input),digest=hash(JSON.stringify({retry,...data}));
 await routingLock(db,merchant);
 const o=(await db.query('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,orderId])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);
 const old=(await db.query('SELECT * FROM fulfillment_requests WHERE merchant_id=$1 AND order_id=$2 AND idempotency_key=$3',[merchant,orderId,data.idempotencyKey])).rows[0];
 if(old){if(old.request_hash!==digest)fail('IDEMPOTENCY_CONFLICT');return old.result;}
 if(o.status!=='PAID')fail('ORDER_NOT_PAYABLE');
 await db.query('INSERT INTO order_fulfillment(merchant_id,order_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[merchant,orderId]);
 const f=(await db.query('SELECT * FROM order_fulfillment WHERE merchant_id=$1 AND order_id=$2 FOR UPDATE',[merchant,orderId])).rows[0];if(f.version!==data.expectedVersion)fail('FULFILLMENT_VERSION_CONFLICT');
 const a=(await db.query('SELECT * FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,orderId])).rows[0];
 if(a?.source_kind==='online'){
  if(retry)fail('NOTIFICATION_NOT_APPLICABLE',422);
  const accepted=(await db.query("SELECT 1 FROM online_food_orders WHERE merchant_id=$1 AND order_id=$2 AND acceptance_status='ACCEPTED'",[merchant,orderId])).rowCount;
  if(!accepted)fail('MERCHANT_ACCEPTANCE_REQUIRED');
 }
 if(retry?f.status!=='READY':({RECEIVED:'PREPARING',PREPARING:'READY',READY:'COLLECTED'} as Record<string,string>)[f.status]!==('status' in data?data.status:''))fail('FULFILLMENT_TRANSITION_INVALID');
 const active=(await db.query<NoticeRow>("SELECT * FROM pickup_notifications WHERE merchant_id=$1 AND order_id=$2 AND state IN ('PENDING','DELIVERED','RENDERED','UNSUPPORTED','TARGET_CHANGED')",[merchant,orderId])).rows;
 for(const n of active)await cancelNotice(db,merchant,n);
 if(a?.source_kind!=='online'&&(retry||'status' in data&&data.status==='READY')){
  if(!a)fail('NOTIFICATION_TARGET_CHANGED');
  const target='targetDeviceId' in data?data.targetDeviceId:a.target_device_id;
  const d=(await db.query('SELECT * FROM devices WHERE merchant_id=$1 AND id=$2 AND revoked_at IS NULL',[merchant,target])).rows[0];if(!d)fail('NOTIFICATION_TARGET_CHANGED');
  const generation='assignmentGeneration' in data?data.assignmentGeneration:String(a.target_assignment_generation);
  const visit=(await db.query(`SELECT v.id,s.pickup_guest_generation::text FROM table_visits v JOIN device_sessions s ON s.merchant_id=v.merchant_id AND s.id=v.session_id AND s.public_visit_id=v.id WHERE v.merchant_id=$1 AND v.order_id=$2`,[merchant,orderId])).rows[0];
  // Initial authority follows the acquired original session, not visit creation.
  // Retry records staff's confirmed current fence separately; the shared
  // predicate still refuses another guest's active cart/order.
  const guestGeneration=retry?String(d.pickup_guest_generation):visit?.pickup_guest_generation??'0';
  const inserted=(await db.query<NoticeRow>("INSERT INTO pickup_notifications(merchant_id,order_id,target_device_id,assignment_generation,auth_generation,serving_table_id,visit_id,guest_generation,binding_confirmed_by,binding_confirmed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9::text IS NULL THEN NULL ELSE clock_timestamp() END) RETURNING *",[merchant,orderId,target,generation,d.auth_generation,a.serving_table_id,visit?.id??null,guestGeneration,retry?actor:null])).rows[0];
  const valid=(await db.query('SELECT bitpos.pickup_binding_current($1::uuid,$2::uuid) AS valid',[merchant,inserted.id])).rows[0].valid;
  if(!valid){if(retry)fail('NOTIFICATION_TARGET_CHANGED');await cancelNotice(db,merchant,inserted,'TARGET_CHANGED');}
 }
 await db.query('UPDATE order_fulfillment SET status=$3,version=version+1,updated_at=clock_timestamp() WHERE merchant_id=$1 AND order_id=$2',[merchant,orderId,retry?f.status:('status' in data?data.status:f.status)]);
 await audit(db,merchant,actor,retry?'order.pickup.resend':'order.fulfillment.'+('status' in data?data.status.toLowerCase():''),orderId);
 const result={fulfillment:(await fulfillmentViews(db,merchant,[orderId])).get(orderId)!};
 await db.query('INSERT INTO fulfillment_requests(merchant_id,order_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4,$5)',[merchant,orderId,data.idempotencyKey,digest,result]);return result;
}
// Called only inside the authenticated stream's tenant transaction. Reconnect
// creates a fresh silent event; stock/payment/order authority remain untouched.
export async function reconcilePickup(db:pg.PoolClient,merchant:string,device:string,connection:string){
 const notices=(await db.query<NoticeRow>("SELECT * FROM pickup_notifications WHERE merchant_id=$1 AND target_device_id=$2 AND (state IN ('PENDING','DELIVERED','RENDERED','UNSUPPORTED') OR state='TARGET_CHANGED' AND last_event_id IS NOT NULL AND cancel_event_id IS NULL AND expires_at>clock_timestamp()) ORDER BY created_at,id FOR UPDATE",[merchant,device])).rows;
 if(!notices.length)return;
 const d=(await db.query(`SELECT d.*,s.kind,s.screen_generation::text,c.capabilities,c.connection_generation::text AS capability_connection FROM devices d JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id LEFT JOIN device_capabilities c ON c.merchant_id=d.merchant_id AND c.device_id=d.id WHERE d.merchant_id=$1 AND d.id=$2`,[merchant,device])).rows[0];
 let occupied=false;
 for(const n of notices){
  if(n.state==='TARGET_CHANGED'){await cancelNotice(db,merchant,n,'TARGET_CHANGED');continue;}
  if(Date.now()>=new Date(n.expires_at).getTime()){await cancelNotice(db,merchant,n,'EXPIRED');continue;}
  if(!(await db.query('SELECT bitpos.pickup_binding_current($1::uuid,$2::uuid) AS valid',[merchant,n.id])).rows[0].valid){await cancelNotice(db,merchant,n,'TARGET_CHANGED');continue;}
  if(d.capability_connection!==connection||!d.capabilities?.includes('pickup_ready_v1')){await db.query("UPDATE pickup_notifications SET state='UNSUPPORTED' WHERE merchant_id=$1 AND id=$2",[merchant,n.id]);continue;}
  if(d.kind!=='idle'||occupied)continue;
  occupied=true;
  if(n.last_event_id&&String(n.last_screen_generation)===d.screen_generation&&String(n.last_connection_generation)===connection)continue;
  const event=await streamEvent(db,merchant,device,String(n.assignment_generation),d.screen_generation,'PICKUP_READY',payload(n,!n.last_event_id&&!n.sound_consumed_at,'READY'));
  await db.query("UPDATE pickup_notifications SET state='DELIVERED',last_event_id=$3,last_screen_generation=$4,last_connection_generation=$5 WHERE merchant_id=$1 AND id=$2",[merchant,n.id,event.eventId,d.screen_generation,connection]);
 }
}
export async function pickupRendered(db:pg.PoolClient,merchant:string,device:string,eventId:string,receivedAt:string){
 await db.query(`UPDATE pickup_notifications n SET state=CASE WHEN n.state='DELIVERED' THEN 'RENDERED' ELSE n.state END,rendered_at=coalesce(n.rendered_at,$4::timestamptz),sound_consumed_at=coalesce(n.sound_consumed_at,$4::timestamptz) FROM outbox_events e WHERE n.merchant_id=$1 AND n.target_device_id=$2 AND n.last_event_id=$3 AND e.merchant_id=n.merchant_id AND e.id=n.last_event_id AND e.type='PICKUP_READY' AND e.payload->'payload'->>'state'='READY' AND n.state IN ('DELIVERED','RENDERED') AND n.expires_at>clock_timestamp() AND bitpos.pickup_binding_current(n.merchant_id,n.id)`,[merchant,device,eventId,receivedAt]);
}
export async function acknowledgePickup(db:pg.PoolClient,merchant:string,device:string,id:string,generation:string){
 const n=(await db.query<NoticeRow>(`SELECT n.* FROM pickup_notifications n JOIN device_screen_state s ON s.merchant_id=n.merchant_id AND s.device_id=n.target_device_id WHERE n.merchant_id=$1 AND n.target_device_id=$2 AND n.id=$3 AND bitpos.pickup_binding_current(n.merchant_id,n.id) AND s.kind='idle' AND s.screen_generation=$4 AND n.last_screen_generation=s.screen_generation AND n.expires_at>clock_timestamp() AND n.state IN ('RENDERED','ACKNOWLEDGED') FOR UPDATE OF n`,[merchant,device,id,generation])).rows[0];if(!n)fail('INVALID_ACK',422);
 if(n.state!=='ACKNOWLEDGED'){await cancelNotice(db,merchant,n,'ACKNOWLEDGED');await db.query('UPDATE pickup_notifications SET acknowledged_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,id]);}
 return {acknowledged:true as const};
}
