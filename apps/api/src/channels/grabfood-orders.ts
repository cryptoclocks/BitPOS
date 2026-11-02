import type pg from 'pg';
import {z} from 'zod';
import {fail} from '../authority';
import {audit} from '../db';
import {advanceChannelStatus,channelEventKey,type ChannelOrderStatus} from '../../../../packages/contracts/src/order-channels';
import {GrabError,type GrabOrder,type GrabEnvironment} from './grabfood-client';
import {grabClientFor,type GrabHttp} from '../channel-connections';
import {resolveMappedProduct} from './item-map';
import {applyChannelStock} from './stock';

const SOURCE='grabfood' as const;
const uuid=z.string().uuid();
/** Grab states we can map. Source: OrderStateRequest in the official SDK. Anything else (e.g. DRIVER_ALLOCATED) leaves BitPOS status unchanged and is kept raw. */
export function mapGrabState(raw:string|null|undefined):ChannelOrderStatus|null{
 switch((raw??'').toUpperCase()){
  case 'ACCEPTED':return 'accepted';
  case 'COLLECTED':case 'DELIVERED':return 'handed_over';
  case 'COMPLETED':case 'BILL_PAID':return 'completed';
  case 'CANCELLED':case 'FAILED':case 'REFUNDED':return 'cancelled';
  default:return null;
 }
}
/** `date` format of List Orders is NOT specified in the SDK; YYYY-MM-DD (shop time) is an unconfirmed assumption. Change only here. */
export const grabListDate=(now:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok'}).format(now);

const int=z.number().int();
const orderShape=z.object({
 orderID:z.string().min(1).max(120),shortOrderNumber:z.string().max(40).default(''),merchantID:z.string().min(1),paymentType:z.string().max(40).default(''),
 orderTime:z.string().datetime({offset:true}),scheduledTime:z.string().nullish(),orderState:z.string().nullish(),
 currency:z.object({code:z.string().regex(/^[A-Z]{3}$/),exponent:z.number().int().min(0).max(4)}).passthrough(),
 items:z.array(z.object({id:z.string().min(1),quantity:int.positive(),price:int.min(0),tax:int.min(0).nullish(),specifications:z.string().nullish(),modifiers:z.array(z.object({id:z.string().nullish(),price:int.nullish(),tax:int.nullish(),quantity:int.nullish()}).passthrough()).nullish()}).passthrough()),
 price:z.object({subtotal:int.min(0),total:int.nullish(),eaterPayment:int.nullish(),merchantEarning:z.object({netEarning:int.nullish()}).passthrough().nullish()}).passthrough()
}).passthrough();

export interface IngestResult{inserted:boolean;duplicate:boolean;rejected:boolean}
/** Persist one polled order exactly once, never moving its status backwards. Orders for another store ID are rejected (branch isolation). */
export async function ingestGrabOrder(db:pg.PoolClient,merchant:string,environment:GrabEnvironment,storeId:string,raw:GrabOrder):Promise<IngestResult>{
 const p=orderShape.safeParse(raw);
 if(!p.success||p.data.merchantID!==storeId)return {inserted:false,duplicate:false,rejected:true};
 const o=p.data,mapped=mapGrabState(o.orderState),cash=o.paymentType.toUpperCase()==='CASH';
 const found=(await db.query<{id:string;status:ChannelOrderStatus;pending_command:string|null}>('SELECT id,status,pending_command FROM channel_orders WHERE merchant_id=$1 AND source=$2 AND environment=$3 AND external_order_id=$4 FOR UPDATE',[merchant,SOURCE,environment,o.orderID])).rows[0];
 const eventKey=channelEventKey({source:SOURCE,environment,externalStoreId:storeId,externalOrderId:o.orderID,externalEventId:o.orderState||'NEW'});
 let id=found?.id,inserted=false;
 if(!found){
  const row=(await db.query<{id:string}>(`INSERT INTO channel_orders(merchant_id,source,environment,external_order_id,external_store_id,short_number,status,raw_status,payment_type,payment_collector,settlement_state,currency_code,currency_exponent,subtotal_minor,total_minor,customer_paid_minor,net_earning_minor,order_time,scheduled_time,snapshot)
   VALUES($1,'grabfood',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
   [merchant,environment,o.orderID,storeId,o.shortOrderNumber,mapped??'received',o.orderState??'',o.paymentType,cash?'cash_on_pickup':'platform',cash?'not_applicable':'receivable',o.currency.code,o.currency.exponent,o.price.subtotal,o.price.total??null,o.price.eaterPayment??null,o.price.merchantEarning?.netEarning??null,o.orderTime,o.scheduledTime||null,JSON.stringify(raw)])).rows[0];
  id=row.id;inserted=true;
  for(const [i,item] of o.items.entries()){
   // Mapping is by the partner-side item id only: an owner-confirmed mapping, or an id that is one of THIS merchant's product ids. Names are never matched.
   const product=await resolveMappedProduct(db,merchant,SOURCE,item.id);
   await db.query('INSERT INTO channel_order_lines(merchant_id,order_id,line_no,external_item_id,qty,unit_minor,tax_minor,note,modifiers,mapped_product_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [merchant,id,i+1,item.id,item.quantity,item.price,item.tax??0,item.specifications??'',JSON.stringify(item.modifiers??[]),product]);
  }
 }
 const ev=await db.query(`INSERT INTO channel_events(merchant_id,event_key,order_id,kind,raw_status,payload) VALUES($1,$2,$3,'poll',$4,$5) ON CONFLICT DO NOTHING`,[merchant,eventKey,id,o.orderState??'',JSON.stringify(raw)]);
 const duplicate=!inserted&&!ev.rowCount;
 if(found&&!duplicate){
  const next=mapped?advanceChannelStatus(found.status,mapped):found.status;
  // A pending accept/reject/ready is resolved by what Grab reports, never by a local timer.
  const clearPending=found.pending_command==='accept'&&next!=='accept_pending'&&next!=='received'||found.pending_command==='reject'&&next==='cancelled'||found.pending_command==='ready'&&['handed_over','completed','cancelled'].includes(next);
  await db.query('UPDATE channel_orders SET status=$3,raw_status=$4,pending_command=CASE WHEN $5 THEN NULL ELSE pending_command END,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,id,next,o.orderState??'',clearPending]);
 }
 // Stock is taken when the shop has accepted the order (fresh orders that arrive already accepted included); never twice.
 if(!duplicate)await applyChannelStock(db,merchant,id!);
 return {inserted,duplicate,rejected:false};
}

/** Pull today's orders for the ACTIVE environment. Rate-limited to one provider call burst per 10 s per merchant. */
export async function syncGrabOrders(db:pg.PoolClient,merchant:string,actor:string,role:string,http?:GrabHttp,now=new Date()){
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 const set=(await db.query<{active_environment:GrabEnvironment;recent:boolean|null}>('SELECT active_environment,clock_timestamp()-last_sync_at< make_interval(secs => 10) AS recent FROM channel_settings WHERE merchant_id=$1 AND source=$2 FOR UPDATE',[merchant,SOURCE])).rows[0];
 const environment:GrabEnvironment=set?.active_environment??'sandbox';
 if(set?.recent)return {environment,skipped:true,inserted:0,updated:0,rejected:0,result:'recent'};
 const store=(await db.query<{external_store_id:string}>('SELECT external_store_id FROM channel_connections WHERE merchant_id=$1 AND source=$2 AND environment=$3',[merchant,SOURCE,environment])).rows[0];
 if(!store)fail('RESOURCE_NOT_FOUND',404);
 const client=await grabClientFor(db,merchant,environment,http);
 let inserted=0,updated=0,rejected=0,result='ok';
 try{
  for(let page=1;page<=10;page++){
   const r=await client.listOrders({date:grabListDate(now),page});
   for(const order of r.orders){const x=await ingestGrabOrder(db,merchant,environment,store.external_store_id,order);if(x.rejected)rejected++;else if(x.inserted)inserted++;else if(!x.duplicate)updated++;}
   if(!r.more)break;
  }
 }catch(e){result=e instanceof GrabError?e.message:'GRAB_UNKNOWN_ERROR';}
 await db.query(`INSERT INTO channel_settings(merchant_id,source,active_environment,last_sync_at,last_sync_result,updated_by) VALUES($1,$2,$3,clock_timestamp(),$4,$5)
  ON CONFLICT(merchant_id,source) DO UPDATE SET last_sync_at=clock_timestamp(),last_sync_result=excluded.last_sync_result`,[merchant,SOURCE,environment,result,actor]);
 return {environment,skipped:false,inserted,updated,rejected,result};
}

const command=z.object({command:z.enum(['accept','reject','ready','preparing'])}).strict();
const FROM:Record<'accept'|'reject'|'ready'|'preparing',ChannelOrderStatus[]>={accept:['received'],reject:['received'],ready:['accepted','preparing'],preparing:['accepted']};
const PENDING={accept:'accept_pending',reject:'reject_pending',ready:null,preparing:null} as const;
const DONE={accept:'accepted',reject:'rejected',ready:'ready',preparing:'preparing'} as const;
/**
 * Accept / reject / ready. The row is moved to a *_pending state and the command recorded before the result is known. If the provider
 * outcome is unknown (timeout after send) the pending marker stays and further commands are refused until a sync shows what Grab did.
 */
export async function grabOrderCommand(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:unknown,input:unknown,http?:GrabHttp){
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 const id=uuid.safeParse(orderId),p=command.safeParse(input);if(!id.success||!p.success)fail('INVALID_REQUEST',422);
 const cmd=p.data.command;
 const o=(await db.query<{status:ChannelOrderStatus;environment:GrabEnvironment;external_order_id:string;pending_command:string|null}>('SELECT status,environment,external_order_id,pending_command FROM channel_orders WHERE merchant_id=$1 AND id=$2 AND source=$3 FOR UPDATE',[merchant,id.data,SOURCE])).rows[0];
 if(!o)fail('RESOURCE_NOT_FOUND',404);
 if(o.pending_command||!FROM[cmd].includes(o.status))fail('INVALID_REQUEST',409);
 // 'preparing' is the kitchen's own step: Grab has no such call, so nothing is sent and no provider outcome can be unknown.
 if(cmd==='preparing'){
  await db.query("UPDATE channel_orders SET status='preparing',last_command_error='',updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[merchant,id.data]);
  await db.query("INSERT INTO channel_events(merchant_id,event_key,order_id,kind,raw_status,payload) VALUES($1,$2,$3,'command','local',$4)",[merchant,`command|${id.data}|preparing|${Date.now()}`,id.data,JSON.stringify({command:cmd,outcome:'done',by:actor})]);
  await audit(db,merchant,actor,'channel.order.preparing',`${SOURCE}:${id.data}`);
  return {id:id.data,command:cmd,outcome:'done' as const,error:''};
 }
 const before=o.status,pending=PENDING[cmd]??before;
 await db.query("UPDATE channel_orders SET status=$3,pending_command=$4,last_command_error='',updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[merchant,id.data,pending,cmd]);
 const client=await grabClientFor(db,merchant,o.environment,http);
 let outcome:'done'|'unknown'|'failed'='done',code='';
 try{
  if(cmd==='ready')await client.markReady(o.external_order_id);else await client.acceptOrReject(o.external_order_id,cmd==='accept'?'Accepted':'Rejected');
 }catch(e){
  code=e instanceof GrabError?e.message:'GRAB_UNKNOWN_ERROR';
  outcome=e instanceof GrabError&&e.kind==='unknown_outcome'?'unknown':'failed';
 }
 if(outcome==='done')await db.query('UPDATE channel_orders SET status=$3,pending_command=NULL,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,id.data,DONE[cmd]]);
 if(outcome==='done')await applyChannelStock(db,merchant,id.data);
 else if(outcome==='failed')await db.query('UPDATE channel_orders SET status=$3,pending_command=NULL,last_command_error=$4,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,id.data,before,code]);
 else await db.query('UPDATE channel_orders SET last_command_error=$3,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,id.data,code]);
 await db.query("INSERT INTO channel_events(merchant_id,event_key,order_id,kind,raw_status,payload) VALUES($1,$2,$3,'command',$4,$5) ON CONFLICT DO NOTHING",[merchant,`command|${id.data}|${cmd}|${Date.now()}`,id.data,outcome,JSON.stringify({command:cmd,outcome,code})]);
 await audit(db,merchant,actor,'channel.order.'+cmd,`${SOURCE}:${id.data}:${outcome}`);
 return {id:id.data,command:cmd,outcome,error:code};
}

export async function listChannelOrders(db:pg.PoolClient,merchant:string,role:string,source:unknown){
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 const s=z.enum(['grabfood','lineman']).safeParse(source);if(!s.success)fail('INVALID_REQUEST',422);
 const orders=(await db.query(`SELECT o.id,o.environment,o.external_order_id,o.short_number,o.status,o.raw_status,o.payment_type,o.payment_collector,o.settlement_state,o.currency_code,o.currency_exponent,o.subtotal_minor::text,o.total_minor::text,o.customer_paid_minor::text,o.net_earning_minor::text,o.order_time,o.pending_command,o.last_command_error,
   COALESCE((SELECT json_agg(json_build_object('lineNo',l.line_no,'externalItemId',l.external_item_id,'qty',l.qty,'unitMinor',l.unit_minor::text,'note',l.note,'mapped',l.mapped_product_id IS NOT NULL,'productId',l.mapped_product_id,'stock',(SELECT json_build_object('requested',e.qty_requested,'applied',e.qty_applied) FROM channel_stock_effects e WHERE e.merchant_id=l.merchant_id AND e.order_id=l.order_id AND e.line_no=l.line_no)) ORDER BY l.line_no) FROM channel_order_lines l WHERE l.merchant_id=o.merchant_id AND l.order_id=o.id),'[]') lines
   FROM channel_orders o WHERE o.merchant_id=$1 AND o.source=$2 ORDER BY o.first_seen_at DESC LIMIT 100`,[merchant,s.data])).rows;
 const set=(await db.query('SELECT active_environment,last_sync_at,last_sync_result FROM channel_settings WHERE merchant_id=$1 AND source=$2',[merchant,s.data])).rows[0];
 const linked=(await db.query("SELECT 1 FROM channel_connections WHERE merchant_id=$1 AND source=$2 AND environment=COALESCE($3,'sandbox') AND state='linked'",[merchant,s.data,set?.active_environment??null])).rowCount===1;
 // Per-currency, platform-collected, finished orders still waiting to be matched with a payout. Different currencies are never added together.
 const receivable=(await db.query(`SELECT currency_code,currency_exponent,count(*)::int orders,COALESCE(sum(net_earning_minor),0)::text net_minor,count(*) FILTER(WHERE net_earning_minor IS NULL)::int unknown_net
   FROM channel_orders WHERE merchant_id=$1 AND source=$2 AND payment_collector='platform' AND status='completed' AND settlement_state='receivable' GROUP BY currency_code,currency_exponent ORDER BY currency_code`,[merchant,s.data])).rows;
 return {source:s.data,receivable:receivable.map(r=>({currency:{code:r.currency_code,decimals:r.currency_exponent},orders:r.orders,netEarningMinor:r.net_minor,ordersWithoutNet:r.unknown_net})),activeEnvironment:set?.active_environment??'sandbox',linked,lastSyncAt:set?.last_sync_at??null,lastSyncResult:set?.last_sync_result??'',orders:orders.map(r=>({id:r.id,environment:r.environment,externalOrderId:r.external_order_id,shortNumber:r.short_number,status:r.status,rawStatus:r.raw_status,paymentType:r.payment_type,paymentCollector:r.payment_collector,settlementState:r.settlement_state,currency:{code:r.currency_code,decimals:r.currency_exponent},subtotalMinor:r.subtotal_minor,totalMinor:r.total_minor,customerPaidMinor:r.customer_paid_minor,netEarningMinor:r.net_earning_minor,orderTime:r.order_time,pendingCommand:r.pending_command,lastCommandError:r.last_command_error,lines:r.lines}))};
}
