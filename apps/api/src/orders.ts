import type pg from 'pg';
import {randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {config,customerOrigin} from './config';
import {canonicalItems,hash,deviceBillLines} from '../../../packages/domain/src/index';
import {money,safeRelease} from '../../../packages/domain/src/table-pricing';
import type {OrderView,OrderAuthority,RoutedAuthority,DeviceOrderView,CounterCreate,OrderStatus,EffectiveLine,Settlement} from '../../../packages/contracts/src/index';
import type {OrderRow,AttemptRow,AuthorityRow,DeviceRow,QuoteRow} from './types';
import {captureQuote,quoteView,quoteRequestHash,validateQuote} from './catalog';
import {activeTable,ensureDevice,expireCart} from './registry';
import {fail,routingLock,uuid,integer,positive} from './authority';
import {fulfillmentViews} from './fulfillment';
import {freezeScopedOrder} from './scoped-offers';
import {validateCoffeeQuote,freezeCoffeeOrder,coffeeOrderViews} from './coffee-order-constraints';
import {finalizeGrantAttempt} from './delegated-payments';
import {freezeDailyOrder} from './daily-promotions';
import {freezePersonalOrder} from './personal-promotions';
import {freezeConfiguredOrder} from './configured-food';
import {MobileConfiguredFoodSnapshotSchema,type MobileConfiguredFoodSnapshot} from '../../../packages/contracts/src/mobile-v1.generated';
import {deliveryProjection,deliverySnapshot,type DeliverySnapshot} from './food-delivery';
type LegacyItem={product_id:string;name:string;name_en:string;qty:number;unit_minor:string};
type DetailExtras={payment_settlement:Settlement;lines:EffectiveLine[]|null;legacy_items:LegacyItem[]|null;effect_id:string|null;consumed_at:Date|null;ambiguous:number;rendered:boolean;can_cancel?:boolean};
type NoAuthority={ [K in keyof AuthorityRow]:null };
type OrderDetails=(AuthorityRow|NoAuthority)&DetailExtras&{payment_quote_id?:string|null;configured_food?:MobileConfiguredFoodSnapshot|null;configured_food_line_count?:number|null};
type V2DetailsWire=AuthorityRow&Omit<DetailExtras,'consumed_at'|'payment_settlement'>&{consumed_at:string|null};
type SettlementSqlRow=
 | (OrderRow&{authority_version:2;settlement_details:V2DetailsWire})
 | {authority_version:null;settlement_details:null};
// One SQL transport boundary: native order dates/bigints, JSON fact strings.
// Frozen nested JSON is preserved, not recalculated or stripped by the decoder.
const factMoney=z.union([
 z.object({currency:z.literal('USD'),decimals:z.union([z.literal(2),z.literal(4)]),amountMinor:integer}).passthrough(),
 z.object({currency:z.literal('THB'),decimals:z.literal(2),amountMinor:integer}).passthrough(),
 z.object({currency:z.literal('USDG'),decimals:z.literal(6),amountMinor:integer}).passthrough()
]);
const factDiscount=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('amount'),amountMinor:integer}).passthrough(),
 z.object({kind:z.literal('percent'),percent:z.number().int().min(0).max(100)}).passthrough()
]);
const factLine=z.object({
 productId:uuid,name:z.string(),nameEn:z.string(),qty:z.number().int().positive(),priceVersion:z.string(),
 basePrice:factMoney,unitPrice:factMoney,
 promotion:z.object({revision:integer,expiresAt:z.string().datetime({offset:true}),discount:factDiscount,priceVersion:z.string()}).passthrough().nullable()
}).passthrough();
const settlementFactsSchema=z.object({
 merchant_id:uuid,order_id:uuid,source_kind:z.enum(['register','device']),
 source_register_id:uuid.nullable(),source_device_id:uuid.nullable(),source_label_snapshot:z.string(),
 target_device_id:uuid,target_assignment_generation:positive,creation_pairing_generation:positive.nullable(),
 screen_generation:positive,serving_kind:z.enum(['table','counter','takeaway']),serving_table_id:uuid.nullable(),
 serving_label_snapshot:z.string(),quote_id:uuid,price_version_id:uuid,catalog_currency:z.enum(['USD','USDG']),
 catalog_decimals:z.union([z.literal(2),z.literal(4),z.literal(6)]),total_minor:positive,
 settlement:z.object({currency:z.enum(['USDG','USDC','USDT']),decimals:z.literal(6),amountMinor:positive,
  network:z.literal('solana:devnet'),genesisHash:z.string(),mint:z.string(),tokenProgram:z.string(),
  testToken:z.literal(true),recipient:z.string(),sponsor:z.literal('merchant_funded')}).passthrough(),
 lines:z.array(factLine).nullable(),
 legacy_items:z.array(z.object({product_id:uuid,name:z.string(),name_en:z.string(),qty:z.number().int().positive(),unit_minor:integer}).strict()).nullable(),
 effect_id:uuid.nullable(),consumed_at:z.string().datetime({offset:true}).nullable(),
 ambiguous:z.number().int().nonnegative(),rendered:z.boolean()
}).strict();
const routedSettlementDetailsSchema=settlementFactsSchema.refine(d=>(d.source_kind==='register'
 ? d.source_register_id!==null&&d.source_device_id===null&&d.creation_pairing_generation!==null
 : d.source_device_id!==null&&d.source_register_id===null&&d.creation_pairing_generation===null)
 &&(d.serving_kind==='table')===(d.serving_table_id!==null)
 &&(d.catalog_currency==='USD'?(d.catalog_decimals===2||d.catalog_decimals===4):d.catalog_decimals===6));
const onlineSettlementDetailsSchema=settlementFactsSchema.extend({
 source_kind:z.literal('online'),source_register_id:z.null(),source_device_id:z.null(),
 source_account_id:uuid,source_branch_id:uuid,target_device_id:z.null(),target_assignment_generation:z.null(),
 creation_pairing_generation:z.null(),screen_generation:z.null(),serving_kind:z.enum(['pickup','delivery']),
 serving_table_id:z.null(),effect_id:z.null(),consumed_at:z.null(),rendered:z.literal(false)
}).refine(d=>d.catalog_currency==='USD'?(d.catalog_decimals===2||d.catalog_decimals===4):d.catalog_decimals===6);
const settlementDetailsSchema:z.ZodType<V2DetailsWire>=z.union([routedSettlementDetailsSchema,onlineSettlementDetailsSchema]);
const settlementOrderSchema=z.object({
 id:uuid,merchant_id:uuid,customer_id:uuid,access_token:z.string(),status:z.enum(['AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING','PAID','EXPIRED','RECOVERY']),
 version:z.number().int().positive(),thb_minor:integer.nullable(),usdg_minor:positive,treasury:z.string(),
 quote_expires_at:z.date(),terminal_id:z.string().nullable(),payer:z.string().nullable(),reservation_released:z.boolean(),
 request_hash:z.string(),created_at:z.date(),recovery_resolved_at:z.date().nullable()
}).passthrough();
const settlementRowSchema:z.ZodType<SettlementSqlRow>=z.discriminatedUnion('authority_version',[
 settlementOrderSchema.extend({authority_version:z.literal(2),settlement_details:settlementDetailsSchema}),
 // Legacy attributes are unused: v2 transport validation must not constrain
 // migration010's historical financial policy or native legacy value range.
 z.object({authority_version:z.null(),settlement_details:z.null()}).passthrough()
]);
function decodeSettlement(row:unknown):SettlementSqlRow{
 const decoded=settlementRowSchema.parse(row);
 if(decoded.authority_version===2&&(decoded.settlement_details.merchant_id!==decoded.merchant_id||decoded.settlement_details.order_id!==decoded.id))throw Error('INVALID_SETTLEMENT_DETAILS');
 return decoded;
}
async function orderDetailsBatch(db:pg.PoolClient,orders:readonly OrderRow[],device=false,includeConfigured=true):Promise<OrderDetails[]>{
 if(!orders.length)return [];
 return (await db.query<OrderDetails>(`
 SELECT a.*,q.lines,CASE WHEN $4 THEN cf.snapshot ELSE NULL END AS configured_food,jsonb_array_length(cf.snapshot->'lines') AS configured_food_line_count,selected.quote_id AS payment_quote_id,bitpos.effective_payment_settlement($1::uuid,requested.id) AS payment_settlement,
 CASE WHEN q.lines IS NULL THEN (SELECT jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',i.name,'name_en',i.name_en,'qty',i.qty,'unit_minor',i.unit_minor::text) ORDER BY i.product_id) FROM order_items i WHERE i.merchant_id=$1 AND i.order_id=requested.id) END AS legacy_items,
 e.effect_id,e.consumed_at,
 requested.status IN ('AWAITING_WALLET','AWAITING_PAYMENT') AND bitpos.unpaid_order_safe($1::uuid,requested.id) AS can_cancel,
 CASE WHEN $3 AND a.order_id IS NOT NULL THEN (SELECT count(*)::int FROM payment_attempts p WHERE p.merchant_id=$1 AND p.order_id=requested.id AND p.status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')) ELSE 0 END AS ambiguous,
 CASE WHEN $3 AND a.order_id IS NOT NULL THEN EXISTS(SELECT 1 FROM device_event_deliveries d JOIN outbox_events b ON b.merchant_id=d.merchant_id AND b.id=d.event_id WHERE d.merchant_id=$1 AND d.device_id=a.target_device_id AND b.order_id=requested.id AND b.order_version=requested.version AND d.status='rendered') ELSE false END AS rendered
 FROM jsonb_to_recordset($2::jsonb) AS requested(id uuid,version integer,status text,position integer)
 LEFT JOIN order_authority a ON a.merchant_id=$1 AND a.order_id=requested.id
 LEFT JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id
 LEFT JOIN order_configured_food cf ON cf.merchant_id=a.merchant_id AND cf.order_id=a.order_id
 LEFT JOIN order_payment_selection selected ON selected.merchant_id=$1 AND selected.order_id=requested.id
 LEFT JOIN device_sound_effects e ON $3 AND requested.status='PAID' AND e.merchant_id=a.merchant_id AND e.device_id=a.target_device_id AND e.order_id=requested.id AND e.paid_version=requested.version
 ORDER BY requested.position
 `,[orders[0].merchant_id,JSON.stringify(orders.map((o,position)=>({id:o.id,version:o.version,status:o.status,position}))),device,includeConfigured])).rows;
}
async function orderDetails(db:pg.PoolClient,o:OrderRow,device=false):Promise<OrderDetails>{
 return (await orderDetailsBatch(db,[o],device))[0];
}
function orderViewFromDetails(o:OrderRow,d:OrderDetails,publicView:boolean):OrderView&{customerId?:string;accessToken?:string;createdAt:string}{
 const a=d.order_id!==null?d:null;
 const items=d.lines??(d.legacy_items??[]).map(i=>({productId:i.product_id,name:i.name,nameEn:i.name_en,qty:i.qty,priceVersion:'legacy_thb',basePrice:money('THB',i.unit_minor),unitPrice:money('THB',i.unit_minor),promotion:null}));
 const configuredCount=d.configured_food_line_count==null?{}:{configuredFoodLineCount:d.configured_food_line_count};
 const authority:OrderAuthority=a?authorityView(a):{kind:'legacy',source:{kind:'legacy_counter',label:'Legacy counter'},serving:{kind:'legacy_unknown',label:'Unknown'},target:{legacyTerminalId:o.terminal_id!}};
 return {id:o.id,status:o.status as OrderStatus,version:o.version,...configuredCount,authority,payer:o.payer,closureReason:o.closure_reason??null,canCancel:!!d.can_cancel,pricing:a?{kind:'versioned',priceVersion:a.price_version_id,lines:items,total:money(a.catalog_currency,a.total_minor,a.catalog_decimals)}:{kind:'legacy_thb',lines:items,total:money('THB',o.thb_minor!)},...(d.configured_food?{configuredFood:MobileConfiguredFoodSnapshotSchema.parse(d.configured_food)}:{}),settlement:d.payment_settlement,...(d.payment_quote_id?{paymentQuoteId:d.payment_quote_id}:{}),quoteExpiresAt:new Date(o.quote_expires_at).toISOString(),paymentUrl:customerOrigin+'/pay/'+o.access_token,createdAt:new Date(o.created_at).toISOString(),...(!publicView?{customerId:o.customer_id,accessToken:o.access_token}:{})};
}
async function onlineAcceptanceViews(db:pg.PoolClient,merchant:string,ids:string[],refundScope:'complete'|'mobile-page'='complete'){
 const rows=(await db.query<{order_id:string;status:NonNullable<OrderView['onlineAcceptance']>['status'];version:number;deadline:Date;reason:string|null;event_sequence:string;preparation_minutes:number|null;preparation_recorded_at:Date|null;refunds:NonNullable<OrderView['onlineAcceptance']>['refunds']}>(`SELECT f.order_id,f.acceptance_status AS status,f.acceptance_version AS version,f.acceptance_deadline AS deadline,f.decision_reason AS reason,f.event_sequence::text,f.preparation_minutes,f.preparation_recorded_at,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',r.id,'version',r.version::text,'money',jsonb_build_object('currency',r.settlement->>'currency','decimals',(r.settlement->>'decimals')::integer,'amountMinor',r.amount_minor::text),'status',r.status,'cause',r.cause) ORDER BY r.created_at,r.id) FROM (SELECT * FROM refunds WHERE merchant_id=f.merchant_id AND order_id=f.order_id ORDER BY created_at,id LIMIT $3) r),'[]'::jsonb) AS refunds
 FROM online_food_orders f WHERE f.merchant_id=$1 AND f.order_id=ANY($2::uuid[])`,[merchant,ids,refundScope==='mobile-page'?31:null])).rows;
 return new Map(rows.map(r=>[r.order_id,{status:r.status,version:r.version,deadline:new Date(r.deadline).toISOString(),reason:r.reason,eventSequence:r.event_sequence,preparation:r.preparation_minutes===null?null:{minutes:r.preparation_minutes,recordedAt:r.preparation_recorded_at!.toISOString()},refunds:r.refunds}]));
}
export async function orderView(db:pg.PoolClient,o:OrderRow,publicView=false,refundScope:'complete'|'mobile-page'='complete'):Promise<OrderView&{customerId?:string;accessToken?:string;createdAt:string}>{
 const view=orderViewFromDetails(o,await orderDetails(db,o),publicView);
 Object.assign(view,(await coffeeOrderViews(db,o.merchant_id,[o.id])).get(o.id));
 view.tableOccupancyGeneration=(await db.query('SELECT o.generation::text FROM order_table_occupancies b JOIN table_occupancies o ON o.merchant_id=b.merchant_id AND o.id=b.occupancy_id WHERE b.merchant_id=$1 AND b.order_id=$2',[o.merchant_id,o.id])).rows[0]?.generation;
 if(!publicView)view.fulfillment=(await fulfillmentViews(db,o.merchant_id,[o.id])).get(o.id);
 view.onlineAcceptance=(await onlineAcceptanceViews(db,o.merchant_id,[o.id],refundScope)).get(o.id);
 if(!publicView&&view.authority.serving.kind==='delivery'){
  const authority=(await db.query<{quote_id:string}>('SELECT quote_id FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[o.merchant_id,o.id])).rows[0];
  const destination=deliveryProjection(await deliverySnapshot(db,o.merchant_id,authority.quote_id));
  if(destination)view.delivery=destination;
 }
 return view;
}
export async function orderViews(db:pg.PoolClient,orders:readonly OrderRow[],publicView=false):Promise<Awaited<ReturnType<typeof orderView>>[]>{
 const details=await orderDetailsBatch(db,orders,false,false);
 const fulfillments=!publicView&&orders.length?await fulfillmentViews(db,orders[0].merchant_id,orders.map(o=>o.id)):null;
 const coffee=orders.length?await coffeeOrderViews(db,orders[0].merchant_id,orders.map(o=>o.id)):null;
 const acceptances=orders.length?await onlineAcceptanceViews(db,orders[0].merchant_id,orders.map(o=>o.id)):null;
 const generations=orders.length?new Map<string,string>((await db.query<{order_id:string;generation:string}>('SELECT b.order_id,o.generation::text FROM order_table_occupancies b JOIN table_occupancies o ON o.merchant_id=b.merchant_id AND o.id=b.occupancy_id WHERE b.merchant_id=$1 AND b.order_id=ANY($2::uuid[])',[orders[0].merchant_id,orders.map(o=>o.id)])).rows.map(r=>[r.order_id,r.generation])):null;
 const destinations=!publicView&&orders.length?new Map((await db.query<DeliverySnapshot&{order_id:string}>("SELECT a.order_id,d.* FROM order_authority a JOIN quote_delivery_snapshots d ON d.merchant_id=a.merchant_id AND d.quote_id=a.quote_id WHERE a.merchant_id=$1 AND a.order_id=ANY($2::uuid[]) AND a.serving_kind='delivery'",[orders[0].merchant_id,orders.map(o=>o.id)])).rows.map(row=>[row.order_id,deliveryProjection(row)])):null;
 return orders.map((o,index)=>({...orderViewFromDetails(o,details[index],publicView),...coffee?.get(o.id),tableOccupancyGeneration:generations?.get(o.id),...(fulfillments?{fulfillment:fulfillments.get(o.id)}:{}),...(acceptances?{onlineAcceptance:acceptances.get(o.id)}:{}),...(destinations?.has(o.id)?{delivery:destinations.get(o.id)!}:{})}));
}
export function authorityView(a:AuthorityRow):OrderAuthority {
 if(a.source_kind==='online')return {
  kind:'versioned',source:{kind:'online',accountId:a.source_account_id,branchId:a.source_branch_id,channel:'customer_app',label:a.source_label_snapshot},
  serving:{kind:a.serving_kind,label:a.serving_label_snapshot},target:null,pairingGeneration:null
 };
 return {kind:'versioned',source:a.source_kind==='register'?{kind:'register',registerId:a.source_register_id!,label:a.source_label_snapshot}:{kind:'device',deviceId:a.source_device_id!,label:a.source_label_snapshot},
  serving:a.serving_kind==='table'?{kind:'table',tableId:a.serving_table_id!,label:a.serving_label_snapshot}:{kind:a.serving_kind,label:a.serving_label_snapshot},
  target:{deviceId:a.target_device_id,assignmentGeneration:String(a.target_assignment_generation)},pairingGeneration:a.creation_pairing_generation===null?null:String(a.creation_pairing_generation)};
}
export async function releaseEligible(db:pg.PoolClient,o:OrderRow,device:string){
 const state=(await db.query(`SELECT
 (SELECT count(*)::int FROM payment_attempts WHERE merchant_id=$1 AND order_id=$2 AND status IN ('BUILDING','READY','SUBMITTING','SUBMITTED','CONFIRMED')) AS ambiguous,
 EXISTS(SELECT 1 FROM device_event_deliveries d JOIN outbox_events e ON e.merchant_id=d.merchant_id AND e.id=d.event_id WHERE d.merchant_id=$1 AND d.device_id=$3 AND e.order_id=$2 AND e.order_version=$4 AND d.status='rendered') AS rendered`,[o.merchant_id,o.id,device,o.version])).rows[0];
 return safeRelease(o.status,o.reservation_released,state.ambiguous,state.rendered,!!o.recovery_resolved_at);
}
function deviceViewFromDetails(o:OrderRow,d:OrderDetails,sound:boolean):DeviceOrderView{
 const v=orderViewFromDetails(o,d,true);
 if(v.authority.kind==='versioned'&&v.authority.target===null)fail('INVALID_REQUEST',422);
 return {id:v.id,status:v.status,version:v.version,authority:v.authority,total:v.pricing.total,settlement:v.settlement,quoteExpiresAt:v.quoteExpiresAt,paymentUrl:v.paymentUrl,items:deviceBillLines(v.pricing.lines.map(i=>({name:i.nameEn||i.name,qty:i.qty}))),lineCount:v.pricing.lines.length,pageCount:Math.ceil(v.pricing.lines.length/4),quoteId:d.quote_id??null,canDismiss:!!d.order_id&&safeRelease(o.status,o.reservation_released,d.ambiguous,d.rendered,!!o.recovery_resolved_at),canCancel:!!d.can_cancel,sound:sound&&!!d.effect_id&&!d.consumed_at,effectId:d.effect_id};
}
export async function deviceOrderView(db:pg.PoolClient,o:OrderRow,sound=false){return deviceViewFromDetails(o,await orderDetails(db,o,true),sound);}
export async function streamEvent(db:pg.PoolClient,merchant:string,device:string,assignment:string,screen:string,type:string,payload:unknown,order?:OrderRow,occurredAt=new Date().toISOString(),authGeneration?:string){
 const id=randomUUID();const envelope={schemaVersion:2,type,eventId:id,deviceId:device,connectionGeneration:'0',assignmentGeneration:assignment,screenGeneration:screen,occurredAt,payload,...(authGeneration?{authGeneration}:{})};
 // Order-bearing snapshots must acquire the outbox FK lock before the counter.
 // Otherwise a concurrent order mutation holds the order and waits for that counter.
 const row=(await db.query<{payload:typeof envelope&{deviceSeq:string}}>(`WITH order_lock AS MATERIALIZED (
 SELECT id FROM orders WHERE merchant_id=$2 AND id=$3::uuid FOR KEY SHARE
 ), seq AS (
 UPDATE device_event_counters SET device_seq=device_seq+1 WHERE merchant_id=$2 AND device_id=$7 AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM order_lock)) RETURNING device_seq
 ), inserted AS (
 INSERT INTO outbox_events(id,merchant_id,order_id,order_version,type,payload,target_device_id,target_assignment_generation,screen_generation,device_seq)
 SELECT $1,$2,$3,$4,$5,$6::jsonb||jsonb_build_object('deviceSeq',seq.device_seq::text),$7,$8,$9,seq.device_seq FROM seq RETURNING payload
 ) SELECT payload,pg_notify('bitpos_device_outbox','') FROM inserted`,[id,merchant,order?.id??null,order?.version??null,type,envelope,device,assignment,screen])).rows[0];
 if(!row)fail('DELIVERY_UNAVAILABLE',503);
 // Validate the actual sequence-bearing frame before the caller can commit/send it.
 if(Buffer.byteLength(JSON.stringify(row.payload))>7100)fail('FRAME_TOO_LARGE',422);
 return row.payload;
}
export async function emitOrder(db:pg.PoolClient,o:OrderRow,occurredAt=new Date().toISOString()){
 if(o.authority_version!==2)return;
 if(o.status==='PAID')await db.query("INSERT INTO device_sound_effects(merchant_id,device_id,order_id,paid_version) SELECT merchant_id,target_device_id,order_id,$3 FROM order_authority WHERE merchant_id=$1 AND order_id=$2 AND source_kind IN ('register','device') ON CONFLICT DO NOTHING",[o.merchant_id,o.id,o.version]);
 const d=await orderDetails(db,o,true);
 if(d.order_id===null)throw Error('MISSING_ORDER_AUTHORITY');
 return publishOrderFromDetails(db,o,d,occurredAt);
}
function publishOrderFromDetails(db:pg.PoolClient,o:OrderRow,d:AuthorityRow&DetailExtras,occurredAt:string){
 if(d.source_kind==='online')return;
 return streamEvent(db,o.merchant_id,d.target_device_id,d.target_assignment_generation,d.screen_generation,'ORDER',deviceViewFromDetails(o,d,true),o,occurredAt);
}
export async function resolveRoute(db:pg.PoolClient,merchant:string,kind:'register'|'device',id:string,servingInput?:CounterCreate['serving']):Promise<{authority:RoutedAuthority;device:DeviceRow}>{
 let register;let deviceId=id;if(kind==='register'){register=(await db.query('SELECT * FROM registers WHERE merchant_id=$1 AND id=$2 AND retired_at IS NULL',[merchant,id])).rows[0];if(!register)fail('RESOURCE_NOT_FOUND',404);if(!register.paired_device_id)fail('REGISTER_UNPAIRED');deviceId=register.paired_device_id;}
 const device=(await db.query('SELECT * FROM devices WHERE merchant_id=$1 AND id=$2 AND revoked_at IS NULL',[merchant,deviceId])).rows[0];if(!device)fail('RESOURCE_NOT_FOUND',404);await ensureDevice(db,merchant,deviceId);await expireCart(db,merchant,deviceId);
 const s=servingInput??(device.table_id?{kind:'table' as const,tableId:device.table_id}:{kind:'counter' as const});const place=s.kind==='table'?{kind:'table' as const,tableId:s.tableId,label:(await activeTable(db,merchant,s.tableId)).label}:{kind:s.kind,label:s.kind==='takeaway'?'Takeaway':'Counter'};
 return {authority:{kind:'versioned',source:kind==='register'?{kind:'register',registerId:id,label:register.label}:{kind:'device',deviceId:id,label:device.label},serving:place,target:{deviceId,assignmentGeneration:String(device.assignment_generation)},pairingGeneration:register?String(register.pairing_generation):null},device};
}
export async function counterQuote(db:pg.PoolClient,merchant:string,id:string,input:{items:CounterCreate['items'];customerId?:string;serving:CounterCreate['serving']}){await routingLock(db,merchant);if(input.customerId&&!(await db.query('SELECT id FROM customers WHERE id=$1',[input.customerId])).rowCount)fail('RESOURCE_NOT_FOUND',404);const r=await resolveRoute(db,merchant,'register',id,input.serving);const q=await captureQuote(db,merchant,{kind:'register',id},input.items,r.authority,input.customerId);const p=(await db.query('SELECT connected_until>clock_timestamp() AS online FROM device_presence WHERE device_id=$1',[r.device.id])).rows[0];const s=(await db.query('SELECT kind FROM device_screen_state WHERE device_id=$1',[r.device.id])).rows[0];return {...quoteView(q),authority:r.authority,pairingGeneration:r.authority.kind==='versioned'?r.authority.pairingGeneration:null,targetOnline:!!p?.online,targetBusy:s.kind!=='idle'};}
export async function submission(db:pg.PoolClient,merchant:string,kind:string,id:string,key:string){return (await db.query('SELECT o.*,s.request_hash AS submission_hash FROM order_submissions s JOIN orders o ON o.merchant_id=s.merchant_id AND o.id=s.order_id WHERE s.merchant_id=$1 AND s.origin_kind=$2 AND s.origin_id=$3 AND s.idempotency_key=$4',[merchant,kind,id,key])).rows[0];}
export async function createRoutedOrder(db:pg.PoolClient,merchant:string,kind:'register'|'device',originId:string,input:CounterCreate|{sessionId:string;cartVersion:string;quoteId:string;priceVersion:string;idempotencyKey:string;expectedScreenGeneration:string}){
 await routingLock(db,merchant);
 const c='items' in input?{...input,items:canonicalItems(input.items)}:null;const d='sessionId' in input?input:null;
 const canonical=c?{items:c.items,customerId:c.customerId??null,serving:c.serving,quoteId:c.quoteId,priceVersion:c.priceVersion}:d?{sessionId:d.sessionId,cartVersion:d.cartVersion,quoteId:d.quoteId,priceVersion:d.priceVersion}:null;
 const fingerprint=hash(JSON.stringify({kind,originId,...canonical}));await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[merchant+kind+originId+input.idempotencyKey]);const old=await submission(db,merchant,kind,originId,input.idempotencyKey);if(old){if(old.submission_hash!==fingerprint)fail('IDEMPOTENCY_CONFLICT');return {order:await orderView(db,old),replayed:true};}
 const q=(await db.query('SELECT * FROM order_quotes WHERE merchant_id=$1 AND id=$2 AND origin_kind=$3 AND origin_id=$4',[merchant,input.quoteId,kind,originId])).rows[0];if(!q)fail('RESOURCE_NOT_FOUND',404);if(q.price_version_id!==input.priceVersion)fail('PRICE_VERSION_CHANGED');
 if(c&&q.request_hash!==quoteRequestHash(c.items,c.customerId,q.authority.serving))fail('QUOTE_CHANGED');if(c&&(c.serving.kind!==q.authority.serving.kind||(c.serving.kind==='table'&&c.serving.tableId!==q.authority.serving.tableId)))fail('QUOTE_CHANGED');
 const route=await resolveRoute(db,merchant,kind,originId,c?.serving);const a=q.authority;
 if(!a.target||a.source.kind==='online')fail('RESOURCE_NOT_FOUND',404);
 if(kind==='register'&&route.authority.pairingGeneration!==a.pairingGeneration)fail('PAIRING_CHANGED');
 if(route.device.id!==a.target.deviceId||String(route.device.assignment_generation)!==a.target.assignmentGeneration)fail('ASSIGNMENT_CHANGED');
 const screen=(await db.query('SELECT * FROM device_screen_state WHERE device_id=$1 FOR UPDATE',[route.device.id])).rows[0];const online=(await db.query('SELECT 1 FROM device_presence WHERE device_id=$1 AND connected_until>clock_timestamp()',[route.device.id])).rowCount;if(!online)fail('DEVICE_OFFLINE',503);
 if(c&&screen.kind!=='idle')fail('DEVICE_BUSY');if(d){if(screen.kind!=='cart'||screen.session_id!==d.sessionId)fail('LEASE_EXPIRED');if(String(screen.screen_generation)!==d.expectedScreenGeneration)fail('DEVICE_BUSY');const session=(await db.query('SELECT * FROM device_sessions WHERE id=$1 AND device_id=$2',[d.sessionId,originId])).rows[0];if(!session||String(session.cart_version)!==d.cartVersion||String(q.cart_version)!==d.cartVersion||q.session_id!==d.sessionId)fail('CART_VERSION_CONFLICT');}
 await validateQuote(db,merchant,q);
 const freshness=(await db.query("SELECT p.connected_until>clock_timestamp() AS online,s.lease_until>clock_timestamp() AS leased FROM device_presence p JOIN device_screen_state s USING(merchant_id,device_id) WHERE p.device_id=$1",[route.device.id])).rows[0];
 if(!freshness?.online)fail('DEVICE_OFFLINE',503);if(d&&!freshness.leased)fail('LEASE_EXPIRED');
 if(c?.customerId&&!(await db.query('SELECT id FROM customers WHERE id=$1',[c.customerId])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 const customer=c?.customerId??(await db.query<{id:string}>('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[merchant])).rows[0].id;
 await validateCoffeeQuote(db,merchant,q);
 const sg=String(BigInt(screen.screen_generation)+1n);
 const o=await createQuotedOrder(db,merchant,{quote:q,customerId:customer,idempotencyKey:input.idempotencyKey,requestHash:fingerprint,screenGeneration:sg});
 await db.query("UPDATE device_screen_state SET kind='order',session_id=NULL,lease_until=NULL,order_id=$3,screen_generation=$4 WHERE merchant_id=$1 AND device_id=$2",[merchant,route.device.id,o.id,sg]);
 if(d)await db.query('UPDATE device_sessions SET ended_at=clock_timestamp() WHERE id=$1',[d.sessionId]);
 await emitOrder(db,o);return {order:await orderView(db,o),replayed:false};
}
/** Persists one validated canonical bill; callers own quote validation and origin locks. */
export async function createQuotedOrder(db:pg.PoolClient,merchant:string,input:{quote:QuoteRow;customerId:string;idempotencyKey:string;requestHash:string;screenGeneration:string|null}):Promise<OrderRow>{
 const q=input.quote,a=q.authority,source=a.source;
 if((source.kind==='online')!==(input.screenGeneration===null))fail('INVALID_REQUEST',422);
 const o=(await db.query<OrderRow>(`INSERT INTO orders(merchant_id,customer_id,access_token,idempotency_key,request_hash,authority_version,usdg_minor,treasury,quote_expires_at)
  VALUES($1,$2,$3,$4,$5,2,$6,$7,clock_timestamp()+interval '5 minutes') RETURNING *`,
  [merchant,input.customerId,randomBytes(32).toString('base64url'),input.idempotencyKey,input.requestHash,q.usdg_minor,q.treasury])).rows[0];
 await db.query(`INSERT INTO order_authority(merchant_id,order_id,source_kind,source_register_id,source_device_id,
  source_label_snapshot,target_device_id,target_assignment_generation,creation_pairing_generation,screen_generation,
  serving_kind,serving_table_id,serving_label_snapshot,quote_id,price_version_id,catalog_currency,catalog_decimals,
  total_minor,settlement,source_account_id,source_branch_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
  [merchant,o.id,source.kind,source.kind==='register'?source.registerId:null,source.kind==='device'?source.deviceId:null,
   source.label,a.target?.deviceId??null,a.target?.assignmentGeneration??null,a.pairingGeneration,input.screenGeneration,
   a.serving.kind,a.serving.kind==='table'?a.serving.tableId:null,a.serving.label,q.id,q.price_version_id,
   q.lines[0].unitPrice.currency,q.lines[0].unitPrice.decimals,q.total_minor,q.settlement,
   source.kind==='online'?source.accountId:null,source.kind==='online'?source.branchId:null]);
 for(const line of q.lines){
  await db.query('UPDATE products SET reserved=reserved+$1 WHERE merchant_id=$2 AND id=$3',[line.qty,merchant,line.productId]);
  await db.query('INSERT INTO order_items(order_id,merchant_id,product_id,name,name_en,qty,unit_minor) VALUES($1,$2,$3,$4,$5,$6,$7)',[o.id,merchant,line.productId,line.name,line.nameEn,line.qty,line.unitPrice.amountMinor]);
  await db.query('INSERT INTO order_line_prices(merchant_id,order_id,product_id,price_version_id,base_minor,offer_revision,currency,decimals) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[merchant,o.id,line.productId,q.price_version_id,line.basePrice.amountMinor,line.promotion?.revision??null,line.unitPrice.currency,line.unitPrice.decimals]);
 }
 await freezeScopedOrder(db,merchant,o.id,q);
 await freezeDailyOrder(db,merchant,o.id,q);
 await freezePersonalOrder(db,merchant,o.id,q);
 await freezeCoffeeOrder(db,merchant,o.id,q.id);
 if(source.kind==='online')await freezeConfiguredOrder(db,merchant,o.id,q.id);
 await db.query(`INSERT INTO order_submissions(merchant_id,origin_kind,origin_id,source_register_id,source_device_id,
  idempotency_key,request_hash,order_id,source_account_id,source_branch_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [merchant,q.origin_kind,q.origin_id,source.kind==='register'?source.registerId:null,source.kind==='device'?source.deviceId:null,
   input.idempotencyKey,input.requestHash,o.id,source.kind==='online'?source.accountId:null,source.kind==='online'?source.branchId:null]);
 return o;
}
export async function dismissOrder(db:pg.PoolClient,merchant:string,device:string,orderId:string,version:number,generation:string){await routingLock(db,merchant);const screen=(await db.query('SELECT * FROM device_screen_state WHERE device_id=$1 FOR UPDATE',[device])).rows[0];if(screen?.kind!=='order'||screen.order_id!==orderId||String(screen.screen_generation)!==generation)fail('ORDER_NOT_RELEASABLE');const o=(await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[orderId])).rows[0];if(o.version!==version)fail('ORDER_NOT_RELEASABLE');if(!await releaseEligible(db,o,device))fail(o.status==='RECOVERY'?'RECOVERY_REQUIRED':'PAYMENT_PENDING');await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[device]);}
export async function releaseReservation(db:pg.PoolClient,o:OrderRow){if(o.reservation_released)return;await db.query('SELECT p.id FROM products p JOIN order_items i ON i.product_id=p.id WHERE i.order_id=$1 ORDER BY p.id FOR UPDATE OF p',[o.id]);await db.query('UPDATE products p SET reserved=p.reserved-i.qty FROM order_items i WHERE i.order_id=$1 AND i.product_id=p.id',[o.id]);await db.query('UPDATE orders SET reservation_released=true WHERE id=$1',[o.id]);o.reservation_released=true;}
// Pending SDK state is recovery authority only while its immutable parent remains
// unresolved. Keep signed attempts/history; retire sidecars after financial truth.
export async function retireTerminalX402Settlements(db:pg.PoolClient,merchant:string){
 return db.query("DELETE FROM x402_pending_settlements s USING payment_attempts a WHERE s.merchant_id=$1 AND a.merchant_id=s.merchant_id AND a.id=s.attempt_id AND (a.status='FINALIZED' OR a.status IN ('FAILED','EXPIRED','REJECTED') AND a.failure_reconciled_at IS NOT NULL)",[merchant]);
}
export async function settleAttempt(db:pg.PoolClient,attempt:AttemptRow,finalized:boolean,verifiedAt=new Date().toISOString()){
 // Fact preparation and JS publication share the verifier caller's transaction.
 const row=(await db.query<Record<string,unknown>>('SELECT (r.updated_order).*,r.details AS settlement_details FROM bitpos.settle_verified_attempt($1::uuid,$2::uuid,$3::uuid,$4::boolean) AS r',[attempt.merchant_id,attempt.order_id,attempt.id,finalized])).rows[0];
 if(finalized){await finalizeGrantAttempt(db,attempt,'finalized');await retireTerminalX402Settlements(db,attempt.merchant_id);}
 const occurredAt=finalized?verifiedAt:new Date().toISOString();
 if(!row)return;
 const updated=decodeSettlement(row);
 if(updated.authority_version===null)return;
 const wire=updated.settlement_details;
 const details:AuthorityRow&DetailExtras={...wire,payment_settlement:wire.settlement,consumed_at:wire.consumed_at===null?null:new Date(wire.consumed_at)};
 await publishOrderFromDetails(db,updated,details,occurredAt);
}
