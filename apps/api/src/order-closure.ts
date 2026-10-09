import type pg from 'pg';
import type {OrderRow,AuthorityRow} from './types';
import {routingLock,fail} from './authority';
import {audit} from './db';
import {releaseReservation,streamEvent} from './orders';

type ClosureReason='canceled'|'timeout';
async function closeLocked(db:pg.PoolClient,merchant:string,orderId:string,reason:ClosureReason,actor:string,exact?:{device:string;version:number;generation:string}){
  const authority=(await db.query<AuthorityRow>('SELECT * FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[merchant,orderId])).rows[0];
  if(exact&&(!authority||authority.target_device_id!==exact.device))fail('ORDER_NOT_RELEASABLE');
  const screen=authority?(await db.query('SELECT * FROM device_screen_state WHERE merchant_id=$1 AND device_id=$2 FOR UPDATE',[merchant,authority.target_device_id])).rows[0]:null;
  const o=(await db.query<OrderRow&{deadline_elapsed:boolean}>('SELECT *,quote_expires_at<=clock_timestamp() AS deadline_elapsed FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,orderId])).rows[0];
  if(!o)fail('RESOURCE_NOT_FOUND',404);
  if(exact){
    // A replay may observe a newer bill; never touch it or claim its release.
    if(o.status==='EXPIRED'&&o.closure_reason==='canceled'&&o.version===exact.version+1)return {replayed:true};
    if(screen?.kind!=='order'||screen.order_id!==orderId||String(screen.screen_generation)!==exact.generation||o.version!==exact.version)fail('ORDER_NOT_RELEASABLE');
  }
  if(o.closure_reason)return {replayed:true};
  if(reason==='timeout'){
    if(!o.deadline_elapsed)return {replayed:false,closed:false};
    if(!['AWAITING_WALLET','AWAITING_PAYMENT','EXPIRED'].includes(o.status))return {replayed:false,closed:false};
  }else if(!['AWAITING_WALLET','AWAITING_PAYMENT'].includes(o.status))fail('ORDER_NOT_PAYABLE');
  await db.query('SELECT id FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2 ORDER BY id FOR UPDATE',[merchant,orderId]);
  const safe=(await db.query<{safe:boolean}>('SELECT bitpos.unpaid_order_safe($1::uuid,$2::uuid) AS safe',[merchant,orderId])).rows[0].safe;
  if(!safe){if(exact)fail('PAYMENT_PENDING');return {replayed:false,closed:false};}
  await releaseReservation(db,o);
  const updated=(await db.query<OrderRow>("UPDATE orders SET status='EXPIRED',closure_reason=$3,version=version+1 WHERE merchant_id=$1 AND id=$2 RETURNING *",[merchant,orderId,reason])).rows[0];
  await db.query("UPDATE payment_attempts SET status='EXPIRED',error=$3 WHERE merchant_id=$1 AND order_id=$2 AND status='BUILDING' AND signature IS NULL AND signed_base64 IS NULL AND transaction_base64 IS NULL",[merchant,orderId,reason==='canceled'?'Canceled before transaction issuance':'Timed out before transaction issuance']);
  await db.query('UPDATE challenges SET used_at=coalesce(used_at,clock_timestamp()) WHERE merchant_id=$1 AND order_id=$2',[merchant,orderId]);
  if(authority){
    // Frozen quotes are immutable evidence; order status already invalidates payment.
    // Never rewrite valid_until on closure (the authority trigger forbids it).
    await db.query('UPDATE device_sessions SET ended_at=coalesce(ended_at,clock_timestamp()),review_quote_id=NULL WHERE merchant_id=$1 AND id IN (SELECT session_id FROM order_quotes WHERE merchant_id=$1 AND id=$2)',[merchant,authority.quote_id]);
    if(screen?.kind==='order'&&screen.order_id===orderId){
      const idle=(await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2 RETURNING screen_generation::text",[merchant,authority.target_device_id])).rows[0];
      await streamEvent(db,merchant,authority.target_device_id,authority.target_assignment_generation,idle.screen_generation,'SNAPSHOT',{screen:{kind:'idle',screenGeneration:idle.screen_generation},closedOrder:{id:orderId,version:updated.version,reason}});
    }
  }
  await audit(db,merchant,actor,reason==='canceled'?'order.cancel_unpaid':'order.timeout_unpaid',orderId);
  return {replayed:false,closed:true};
}

export async function cancelUnpaidOrder(db:pg.PoolClient,merchant:string,device:string,orderId:string,version:number,generation:string,actor:string){
  await routingLock(db,merchant);
  return closeLocked(db,merchant,orderId,'canceled',actor,{device,version,generation});
}

export async function expireUnpaidOrders(db:pg.PoolClient,merchant:string){
  await routingLock(db,merchant);
  const rows=(await db.query<{id:string}>("SELECT o.id FROM orders o WHERE o.merchant_id=$1 AND o.closure_reason IS NULL AND o.quote_expires_at<=clock_timestamp() AND (o.status IN ('AWAITING_WALLET','AWAITING_PAYMENT') OR (o.status='EXPIRED' AND EXISTS(SELECT 1 FROM device_screen_state s WHERE s.merchant_id=o.merchant_id AND s.order_id=o.id AND s.kind='order'))) ORDER BY o.id",[merchant])).rows;
  for(const row of rows){
    await db.query('SAVEPOINT unpaid_expiry');
    try { await closeLocked(db,merchant,row.id,'timeout','worker'); await db.query('RELEASE SAVEPOINT unpaid_expiry'); }
    catch(error){ await db.query('ROLLBACK TO SAVEPOINT unpaid_expiry'); await db.query('RELEASE SAVEPOINT unpaid_expiry'); console.error('Unpaid expiry blocked; original reservation retained',row.id,(error as {code?:string}).code??'unknown'); }
  }
}
