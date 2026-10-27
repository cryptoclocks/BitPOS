import type pg from 'pg';
import {z} from 'zod';
import type {TableOccupancyView,TableClearResult} from '../../../packages/contracts/src/table-visits';
import {hash} from '../../../packages/domain/src/index';
import {audit} from './db';
import {fail,positive,uuid,routingLock} from './authority';
import {currentScreen} from './device-commands';
import {dismissOrder,streamEvent} from './orders';
import {cancelPromotionTarget} from './promotion-lifecycle';
import {invalidateTablePickups} from './fulfillment';
import {currentPromotionPlaylist} from './promotion-playlists';
import {cancelPersonalTable} from './personal-promotions';

export async function tableOccupancyView(db:pg.PoolClient,merchant:string,table:string,visit?:string):Promise<TableOccupancyView>{
 const row=(await db.query(`SELECT t.occupancy_generation::text AS generation,t.occupancy_timeout_minutes,
 o.opened_at,o.last_activity_at,o.id IS NOT NULL AS active,
 EXISTS(SELECT 1 FROM table_occupancy_visits m WHERE m.merchant_id=t.merchant_id AND m.occupancy_id=o.id AND m.visit_id=$3) AS joined
 FROM merchant_tables t LEFT JOIN table_occupancies o ON o.merchant_id=t.merchant_id AND o.table_id=t.id AND o.closed_at IS NULL
 WHERE t.merchant_id=$1 AND t.id=$2 AND t.retired_at IS NULL`,[merchant,table,visit??null])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);
 return {generation:row.generation,active:row.active,joined:row.joined,openedAt:row.opened_at?.toISOString()??null,lastActivityAt:row.last_activity_at?.toISOString()??null,timeoutMinutes:row.occupancy_timeout_minutes};
}
export async function assertVisitOccupancy(db:pg.PoolClient,merchant:string,visit:string){
 if(!(await db.query(`SELECT 1 FROM table_visit_epochs e JOIN merchant_tables t ON t.merchant_id=e.merchant_id AND t.id=e.table_id
 WHERE e.merchant_id=$1 AND e.visit_id=$2 AND e.generation=t.occupancy_generation AND t.retired_at IS NULL`,[merchant,visit])).rowCount)fail('TABLE_OCCUPANCY_CHANGED');
}
export async function validateOccupancyQuote(db:pg.PoolClient,merchant:string,quote:string,table:string|null){
 if(!table)return;
 if(!(await db.query(`SELECT 1 FROM quote_table_occupancies q JOIN table_occupancies o ON o.merchant_id=q.merchant_id AND o.id=q.occupancy_id
 JOIN merchant_tables t ON t.merchant_id=q.merchant_id AND t.id=q.table_id
 JOIN devices d ON d.merchant_id=q.merchant_id AND d.id=q.target_device_id
 WHERE q.merchant_id=$1 AND q.quote_id=$2 AND q.table_id=$3 AND o.closed_at IS NULL AND t.retired_at IS NULL
 AND q.generation=t.occupancy_generation AND d.assignment_generation=q.assignment_generation AND d.auth_generation=q.auth_generation AND d.revoked_at IS NULL`,[merchant,quote,table])).rowCount)fail('TABLE_OCCUPANCY_CHANGED');
}
const clearSchema=z.object({expectedGeneration:positive,idempotencyKey:uuid,confirmClear:z.literal(true)}).strict();
export async function clearTableOccupancy(db:pg.PoolClient,merchant:string,actor:string,role:string,table:string,input:unknown,reason:'STAFF_CLEAR'|'INACTIVITY'='STAFF_CLEAR'):Promise<TableClearResult>{
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 const d=clearSchema.parse(input),digest=hash(JSON.stringify([reason,d]));await routingLock(db,merchant);
 const old=(await db.query('SELECT request_hash,result FROM table_clear_requests WHERE merchant_id=$1 AND table_id=$2 AND idempotency_key=$3',[merchant,table,d.idempotencyKey])).rows[0];
 if(old){if(old.request_hash!==digest)fail('IDEMPOTENCY_CONFLICT');return old.result;}
 const current=(await db.query('SELECT occupancy_generation::text AS generation FROM merchant_tables WHERE merchant_id=$1 AND id=$2 AND retired_at IS NULL FOR UPDATE',[merchant,table])).rows[0];
 if(!current)fail('RESOURCE_NOT_FOUND',404);if(current.generation!==d.expectedGeneration)fail('TABLE_OCCUPANCY_CHANGED');
 if(reason==='INACTIVITY'&&!(await db.query('SELECT 1 FROM table_occupancies o JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id WHERE o.merchant_id=$1 AND o.table_id=$2 AND o.closed_at IS NULL AND o.generation=t.occupancy_generation AND o.last_activity_at+make_interval(mins=>t.occupancy_timeout_minutes)<=clock_timestamp()',[merchant,table])).rowCount)fail('TABLE_OCCUPANCY_CHANGED');
 const unpaid=(await db.query(`SELECT count(*)::int AS count FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id
 WHERE o.merchant_id=$1 AND a.serving_table_id=$2 AND NOT(o.status='PAID' OR o.status='EXPIRED' AND o.reservation_released OR o.status='RECOVERY' AND o.reservation_released AND o.recovery_resolved_at IS NOT NULL)`,[merchant,table])).rows[0].count;
 if(unpaid)fail('TABLE_CLEAR_BLOCKED',409,{reason:'UNPAID_ORDER',count:unpaid});
 const ambiguous=(await db.query(`SELECT count(*)::int AS count FROM payment_attempts p JOIN order_authority a ON a.merchant_id=p.merchant_id AND a.order_id=p.order_id
 WHERE p.merchant_id=$1 AND a.serving_table_id=$2 AND (p.status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')
 OR p.status IN ('FAILED','EXPIRED','REJECTED') AND p.failure_reconciled_at IS NULL AND (p.signature IS NOT NULL OR p.signed_base64 IS NOT NULL))`,[merchant,table])).rows[0].count;
 if(ambiguous)fail('TABLE_CLEAR_BLOCKED',409,{reason:'PAYMENT_RECONCILIATION_REQUIRED',count:ambiguous});
 const devices=(await db.query(`SELECT d.id,d.assignment_generation::text,s.kind,s.order_id,s.screen_generation::text,o.version
 FROM devices d JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
 LEFT JOIN orders o ON o.merchant_id=s.merchant_id AND o.id=s.order_id
 WHERE d.merchant_id=$1 AND d.table_id=$2 AND d.revoked_at IS NULL ORDER BY d.id FOR UPDATE OF s`,[merchant,table])).rows;
 // Existing dismiss policy requires rendered financial truth. Clear never invents
 // a display ACK or turns guest acknowledgment into collection.
 for(const device of devices)if(device.kind==='order')await dismissOrder(db,merchant,device.id,device.order_id,device.version,device.screen_generation);
 const targets=(await db.query(`SELECT target.* FROM promotion_targets target JOIN table_entries e ON e.merchant_id=target.merchant_id AND e.id=target.entry_id
 WHERE target.merchant_id=$1 AND e.table_id=$2 AND target.state IN ('QUEUED','DELIVERED','RENDERED') FOR UPDATE OF target`,[merchant,table])).rows;
 for(const target of targets)await cancelPromotionTarget(db,merchant,target,'REVOKED','TABLE_CLEARED');
 await invalidateTablePickups(db,merchant,table);
 await cancelPersonalTable(db,merchant,table,d.expectedGeneration);
 await db.query("UPDATE table_occupancies SET closed_at=clock_timestamp(),close_reason=$3 WHERE merchant_id=$1 AND table_id=$2 AND closed_at IS NULL",[merchant,table,reason]);
 const next=(await db.query('UPDATE merchant_tables SET occupancy_generation=occupancy_generation+1 WHERE merchant_id=$1 AND id=$2 RETURNING occupancy_generation::text AS generation',[merchant,table])).rows[0].generation;
 const effects:{deviceId:string;eventId:string;screenGeneration:string}[]=[];
 for(const device of devices){
  await db.query('UPDATE device_sessions SET ended_at=clock_timestamp() WHERE merchant_id=$1 AND device_id=$2 AND ended_at IS NULL',[merchant,device.id]);
  await db.query('UPDATE devices SET pickup_guest_generation=pickup_guest_generation+1 WHERE merchant_id=$1 AND id=$2',[merchant,device.id]);
  await db.query("UPDATE device_screen_state SET kind='idle',session_id=NULL,order_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[merchant,device.id]);
  const screen=await currentScreen(db,merchant,device.id),promotionPlaylist=await currentPromotionPlaylist(db,merchant,device.id,true),event=await streamEvent(db,merchant,device.id,device.assignment_generation,screen.screenGeneration,'CART',{...screen,promotionPlaylist});
  await db.query('INSERT INTO table_clear_effects VALUES($1,$2,$3,$4,$5)',[merchant,table,next,device.id,event.eventId]);
  effects.push({deviceId:device.id,eventId:event.eventId,screenGeneration:screen.screenGeneration});
 }
 const result:TableClearResult={cleared:true,generation:next,effects,preserved:{bills:true,payments:true,walletPermissions:true}};
 await db.query('INSERT INTO table_clear_requests(merchant_id,table_id,idempotency_key,request_hash,actor_id,result) VALUES($1,$2,$3,$4,$5,$6)',[merchant,table,d.idempotencyKey,digest,actor,result]);
 await audit(db,merchant,actor,'table.clear',table);return result;
}
