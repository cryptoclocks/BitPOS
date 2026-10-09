import type pg from 'pg';
import {z} from 'zod';
import type {DeviceCommand,DeviceScreen,DeviceQuote,LinePage,CatalogPage,DeviceResultValue,DeviceResult,DeviceCommandResult,CartItem,OrderStatus} from '../../../packages/contracts/src/index';
import {hash,deviceBillLines} from '../../../packages/domain/src/index';
import {draftItems,money,safeRelease} from '../../../packages/domain/src/table-pricing';
import {cart,uuid,integer,positive,fail,RequestError,routingLock} from './authority';
import {expireCart} from './registry';
import {resolveRoute,deviceOrderView,createRoutedOrder,submission,dismissOrder,authorityView} from './orders';
import {cancelUnpaidOrder} from './order-closure';
import {effectiveCatalog,captureQuote,quoteView} from './catalog';
import {menuAssetManifest} from './idle-menu';
import type {QuoteRow,AuthorityRow} from './types';
import {config,customerOrigin} from './config';
export interface DeviceActor {merchant:string;device:string;tokenHash:string;authGeneration:string;connectionGeneration:string;connectionId:string;}
type ScreenData={screen_generation:string;assignment_generation:string}&(
 {kind:'idle'}|
 {kind:'cart';session_id:string;cart_version:string;lease_until:string;cart:CartItem[];review:Parameters<typeof quoteView>[0]|null}|
 {kind:'order';order_id:string;status:OrderStatus;version:number;authority:AuthorityRow;quote_expires_at:string;access_token:string;lines:QuoteRow['lines'];reservation_released:boolean;recovery_resolved_at:string|null;ambiguous:boolean;rendered:boolean;can_cancel:boolean}
);
type HeartbeatData={screenGeneration:string;assignmentGeneration:string}&(
 {kind:'heartbeat';screenData:ScreenData}|{kind:'replay';requestHash:string;result:DeviceResult}
);
function commandDigest(c:DeviceCommand){const {connectionGeneration:_,requestId:__,schemaVersion:___,...semantic}=c;return hash(JSON.stringify(semantic));}
const envelope={schemaVersion:z.literal(2),requestId:uuid,connectionGeneration:positive};const session={sessionId:uuid};const screen={expectedScreenGeneration:positive};const version={cartVersion:integer};
export const commandSchema=z.discriminatedUnion('type',[
 z.object({...envelope,type:z.literal('CART_OPEN'),...session,...screen,expectedAssignmentGeneration:positive,recoverSessionId:uuid.nullable()}).strict(),
 z.object({...envelope,type:z.literal('CART_SET'),...session,...screen,expectedAssignmentGeneration:positive,expectedCartVersion:integer,items:cart}).strict(),
 z.object({...envelope,type:z.literal('CART_REVIEW'),...session,...screen,...version,expectedPriceVersion:uuid}).strict(),
 z.object({...envelope,type:z.literal('ORDER_SUBMIT'),...session,...screen,...version,quoteId:uuid,priceVersion:uuid,idempotencyKey:z.string().min(1).max(128)}).strict(),
 z.object({...envelope,type:z.literal('CART_RELEASE'),...session,...screen,...version}).strict(),
 z.object({...envelope,type:z.literal('ORDER_DISMISS'),orderId:uuid,orderVersion:z.number().int().positive(),screenGeneration:positive}).strict(),
 z.object({...envelope,type:z.literal('ORDER_CANCEL'),orderId:uuid,orderVersion:z.number().int().positive(),screenGeneration:positive}).strict(),
 z.object({...envelope,type:z.literal('SESSION_SYNC'),pendingRequestId:uuid.nullable(),pendingSubmissionKey:z.string().min(1).max(128).nullable(),sessionId:uuid.nullable()}).strict(),
 z.object({...envelope,type:z.literal('CATALOG_PAGE'),menuVersion:z.string().length(64).nullable(),pageIndex:z.number().int().nonnegative()}).strict(),
 z.object({...envelope,type:z.literal('QUOTE_PAGE'),quoteId:uuid,pageIndex:z.number().int().nonnegative()}).strict(),
 z.object({...envelope,type:z.literal('HEARTBEAT'),sessionId:uuid.nullable()}).strict(),
 z.object({...envelope,type:z.literal('ACK'),eventId:uuid,deviceSeq:positive,orderId:uuid.nullable(),orderVersion:z.number().int().positive().nullable(),screenGeneration:positive,rendered:z.literal(true)}).strict()
]);
export async function validateActor(db:pg.PoolClient,a:DeviceActor){if(!(await db.query('SELECT 1 FROM device_credentials c JOIN devices d ON d.merchant_id=c.merchant_id AND d.id=c.device_id JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id WHERE c.token_hash=$1 AND c.revoked_at IS NULL AND d.revoked_at IS NULL AND c.auth_generation=d.auth_generation AND c.auth_generation=$2 AND d.id=$3 AND p.connection_generation=$4 AND p.connection_id=$5 AND d.merchant_id=$6 AND p.connected_until>clock_timestamp()',[a.tokenHash,a.authGeneration,a.device,a.connectionGeneration,a.connectionId,a.merchant])).rowCount)fail('DEVICE_AUTH_INVALID',401);}
export function deviceQuote(q:Parameters<typeof quoteView>[0]):DeviceQuote { const v=quoteView(q);return {quoteId:v.id,priceVersion:v.priceVersion,cartVersion:v.cartVersion,total:v.total,settlement:v.settlement,validUntil:v.validUntil,lineCount:v.lines.length,pageCount:Math.ceil(v.lines.length/4)}; }
export function linePage(q:QuoteRow,index:number):LinePage { const count=Math.ceil(q.lines.length/4);if(index>=count)fail('RESOURCE_NOT_FOUND',404);return {quoteId:q.id,pageIndex:index,pageCount:count,lineCount:q.lines.length,lines:q.lines.slice(index*4,index*4+4)}; }
export async function currentScreen(db:pg.PoolClient,merchant:string,device:string):Promise<DeviceScreen>{
 const s=(await db.query<{data:ScreenData}>('SELECT bitpos.device_current_screen_data($1::uuid,$2::uuid) AS data',[merchant,device])).rows[0].data;
 return screenFromData(s);
}
function screenFromData(s:ScreenData):DeviceScreen{
 const screenGeneration=s.screen_generation;
 if(s.kind==='idle')return {kind:'idle',screenGeneration};
 if(s.kind==='cart')return {kind:'cart',screenGeneration,sessionId:s.session_id,cartVersion:s.cart_version,leaseUntil:new Date(s.lease_until).toISOString(),items:s.cart,review:s.review?deviceQuote(s.review):null};
 const canDismiss=safeRelease(s.status,s.reservation_released,Number(s.ambiguous),s.rendered,!!s.recovery_resolved_at);
 const order={id:s.order_id,status:s.status,version:s.version,authority:authorityView(s.authority),total:money(s.authority.catalog_currency,s.authority.total_minor),settlement:s.authority.settlement,quoteExpiresAt:new Date(s.quote_expires_at).toISOString(),paymentUrl:customerOrigin+'/pay/'+s.access_token,items:deviceBillLines(s.lines.map((i:QuoteRow['lines'][number])=>({name:i.nameEn||i.name,qty:i.qty}))),lineCount:s.lines.length,pageCount:Math.ceil(s.lines.length/4),quoteId:s.authority.quote_id,canDismiss,canCancel:!!s.can_cancel,sound:false,effectId:null};
 return {kind:'order',screenGeneration,order,canDismiss};
}
export async function recoverableDraft(db:pg.PoolClient,a:DeviceActor){const c=(await db.query('SELECT * FROM device_sessions WHERE device_id=$1 AND ended_at IS NOT NULL AND jsonb_array_length(cart)>0 AND NOT EXISTS(SELECT 1 FROM order_quotes q JOIN order_authority o ON o.merchant_id=q.merchant_id AND o.quote_id=q.id WHERE q.session_id=device_sessions.id) ORDER BY created_at DESC LIMIT 1',[a.device])).rows[0];return c?{sessionId:c.id,cartVersion:String(c.cart_version),items:c.cart}:null;}
export async function catalogPage(db:pg.PoolClient,a:DeviceActor,version:string|null,index:number):Promise<CatalogPage>{
 const m=await effectiveCatalog(db,a.merchant);if(version&&version!==m.menuVersion)fail('MENU_CHANGED');
 const count=Math.max(1,Math.ceil((m.priceVersion?m.products.length:0)/4));if(index>=count)fail('RESOURCE_NOT_FOUND',404);
 const base={menuVersion:m.menuVersion,generatedAt:m.asOf,validUntil:m.priceValidUntil,pageIndex:index,pageCount:count,productCount:m.priceVersion?m.products.length:0,assetManifestVersion:'bitpos-menu-v1' as const};
 if(!m.priceVersion||!m.currency)return {...base,priceVersion:null,currency:null,decimals:null,products:[]};
 const manifest=menuAssetManifest();const products=m.products.slice(index*4,index*4+4).map(p=>{if(!p.basePrice||!p.unitPrice)fail('SETUP_REQUIRED');const asset=manifest?.assets.findIndex(asset=>asset.catalogKey===p.catalogKey)??-1;return {productId:p.id,catalogKey:p.catalogKey,name:p.name,nameEn:p.nameEn,category:typeof p.category==='string'?p.category:null,available:p.available,basePrice:p.basePrice,unitPrice:p.unitPrice,promotion:p.promotion,assetId:asset>=0?asset:null};});
 return m.currency==='USD'?{...base,priceVersion:m.priceVersion,currency:'USD',decimals:2,products}:{...base,priceVersion:m.priceVersion,currency:'USDG',decimals:6,products};
}
export async function applyDeviceCommand(db:pg.PoolClient,a:DeviceActor,c:DeviceCommand,receivedAt:string):Promise<DeviceCommandResult>{
 if(c.connectionGeneration!==a.connectionGeneration)fail('DEVICE_AUTH_INVALID',401);
 if(c.type==='HEARTBEAT'){
 // The routine holds the routing mutex, validates live authority and handles
 // replay/expiry/renewal plus one canonical read. Savepoint preserves oversized
 // response rollback without adding per-step network RTTs to the business work.
 await db.query('SAVEPOINT device_heartbeat');
 const row=(await db.query<{heartbeat:HeartbeatData|null}>('SELECT bitpos.device_heartbeat($1::uuid,$2::uuid,$3::text,$4::bigint,$5::bigint,$6::uuid,$7::uuid,$8::uuid) AS heartbeat',[a.merchant,a.device,a.tokenHash,a.authGeneration,a.connectionGeneration,a.connectionId,c.sessionId,c.requestId])).rows[0].heartbeat;
 if(!row)fail('DEVICE_AUTH_INVALID',401);
 const result:DeviceResult=row.kind==='replay'?(row.requestHash===commandDigest(c)?row.result:{ok:false,error:new RequestError(409,'COMMAND_CONFLICT').view}):{ok:true,value:{screen:screenFromData(row.screenData)}};
 if(Buffer.byteLength(JSON.stringify(result))>6400){
 await db.query('ROLLBACK TO SAVEPOINT device_heartbeat');await db.query('RELEASE SAVEPOINT device_heartbeat');
 return response(db,a,c,{ok:false,error:new RequestError(422,'FRAME_TOO_LARGE').view});
 }
 await db.query('RELEASE SAVEPOINT device_heartbeat');
 return {schemaVersion:2,type:'COMMAND_RESULT',requestId:c.requestId,connectionGeneration:a.connectionGeneration,screenGeneration:row.screenGeneration,assignmentGeneration:row.assignmentGeneration,result};
 }
 await routingLock(db,a.merchant);
 if(c.type==='ACK'){
 // Routing lock is already held. The next statement gets a fresh snapshot after
 // any lock wait and atomically validates, records render, consumes sound, and
 // returns the envelope. No cart expiry, quote/catalog reads, or savepoint RTTs.
 const digest=hash(JSON.stringify({type:c.type,eventId:c.eventId,deviceSeq:c.deviceSeq,orderId:c.orderId,orderVersion:c.orderVersion,screenGeneration:c.screenGeneration,rendered:c.rendered}));
 const row=(await db.query(`WITH live AS MATERIALIZED (
 SELECT d.assignment_generation::text,s.screen_generation::text FROM devices d
 JOIN device_credentials c ON c.merchant_id=d.merchant_id AND c.device_id=d.id
 JOIN device_presence p ON p.merchant_id=d.merchant_id AND p.device_id=d.id
 JOIN device_screen_state s ON s.merchant_id=d.merchant_id AND s.device_id=d.id
 WHERE d.merchant_id=$1 AND d.id=$2 AND c.token_hash=$12 AND c.revoked_at IS NULL AND d.revoked_at IS NULL
 AND c.auth_generation=d.auth_generation AND c.auth_generation=$11 AND p.connection_generation=$4 AND p.connection_id=$13 AND p.connected_until>clock_timestamp()
 ), old AS MATERIALIZED (
 SELECT request_hash,result FROM device_command_results WHERE merchant_id=$1 AND device_id=$2 AND request_id=$10 AND EXISTS(SELECT 1 FROM live)
 ), event AS MATERIALIZED (
 SELECT e.* FROM outbox_events e JOIN device_event_deliveries d ON d.merchant_id=e.merchant_id AND d.event_id=e.id AND d.device_id=e.target_device_id
 JOIN device_screen_state s ON s.merchant_id=e.merchant_id AND s.device_id=e.target_device_id
 LEFT JOIN orders o ON o.merchant_id=e.merchant_id AND o.id=e.order_id
 WHERE e.merchant_id=$1 AND d.device_id=$2 AND e.id=$3 AND d.connection_generation=$4 AND d.status IN ('sent','rendered')
 AND e.device_seq=$5 AND e.order_id IS NOT DISTINCT FROM $6::uuid AND e.order_version IS NOT DISTINCT FROM $7::int AND e.screen_generation=$8
 AND s.screen_generation=e.screen_generation AND (e.order_id IS NULL OR (s.kind='order' AND s.order_id=e.order_id AND o.version=e.order_version))
 AND EXISTS(SELECT 1 FROM live) AND NOT EXISTS(SELECT 1 FROM old)
 ), rendered AS (
 UPDATE device_event_deliveries d SET status='rendered',rendered_at=$9::timestamptz,
 latency_ms=floor(extract(epoch FROM($9::timestamptz-(e.payload->>'occurredAt')::timestamptz))*1000)
 FROM event e WHERE d.merchant_id=$1 AND d.device_id=$2 AND d.event_id=e.id AND d.connection_generation=$4 AND d.rendered_at IS NULL RETURNING d.event_id
 ), consumed AS (
 UPDATE device_sound_effects f SET consumed_at=coalesce(f.consumed_at,$9::timestamptz)
 FROM event e WHERE f.merchant_id=$1 AND f.device_id=$2 AND e.type='ORDER'
 AND e.payload->'payload'->>'sound'='true' AND f.effect_id::text=e.payload->'payload'->>'effectId' RETURNING f.effect_id
 ) SELECT live.*,EXISTS(SELECT 1 FROM event) AS valid,(SELECT request_hash FROM old) AS request_hash,(SELECT result FROM old) AS result FROM live`,
 [a.merchant,a.device,c.eventId,a.connectionGeneration,c.deviceSeq,c.orderId,c.orderVersion,c.screenGeneration,receivedAt,c.requestId,a.authGeneration,a.tokenHash,a.connectionId])).rows[0];
 if(!row)fail('DEVICE_AUTH_INVALID',401);
 const result:DeviceResult=row.request_hash?(row.request_hash===digest?row.result:{ok:false,error:new RequestError(409,'COMMAND_CONFLICT').view}):row.valid?{ok:true,value:{acknowledged:true}}:{ok:false,error:new RequestError(422,'INVALID_ACK').view};
 return {schemaVersion:2,type:'COMMAND_RESULT',requestId:c.requestId,connectionGeneration:a.connectionGeneration,screenGeneration:row.screen_generation,assignmentGeneration:row.assignment_generation,result};
 }
 await validateActor(db,a);
 const digest=commandDigest(c);const old=(await db.query('SELECT * FROM device_command_results WHERE device_id=$1 AND request_id=$2',[a.device,c.requestId])).rows[0];if(old){if(old.request_hash!==digest)return response(db,a,c,{ok:false,error:new RequestError(409,'COMMAND_CONFLICT').view});return response(db,a,c,old.result);}
 await expireCart(db,a.merchant,a.device);await db.query('SAVEPOINT device_command');let value:DeviceResultValue|undefined;
 try{
 if('sessionId' in c&&c.sessionId&&['CART_SET','CART_REVIEW','CART_RELEASE','ORDER_SUBMIT'].includes(c.type)&&(await db.query('SELECT 1 FROM device_sessions WHERE merchant_id=$1 AND id=$2 AND public_visit_id IS NOT NULL',[a.merchant,c.sessionId])).rowCount)fail('ROLE_REQUIRED',403);
 if(c.type==='ORDER_SUBMIT'){
 const created=await createRoutedOrder(db,a.merchant,'device',a.device,{sessionId:c.sessionId,cartVersion:c.cartVersion,quoteId:c.quoteId,priceVersion:c.priceVersion,idempotencyKey:c.idempotencyKey,expectedScreenGeneration:c.expectedScreenGeneration});const o=(await db.query('SELECT * FROM orders WHERE id=$1',[created.order.id])).rows[0];value={order:await deviceOrderView(db,o),replayed:created.replayed};
 }else if(c.type==='SESSION_SYNC'){
 const pending=c.pendingRequestId?(await db.query('SELECT result FROM device_command_results WHERE device_id=$1 AND request_id=$2',[a.device,c.pendingRequestId])).rows[0]:null;const o=c.pendingSubmissionKey?await submission(db,a.merchant,'device',a.device,c.pendingSubmissionKey):null;value={screen:await currentScreen(db,a.merchant,a.device),recoverableDraft:await recoverableDraft(db,a),pendingResult:pending?.result??null,pendingOrder:o?await deviceOrderView(db,o):null};
 }else if(c.type==='CATALOG_PAGE')value={catalog:await catalogPage(db,a,c.menuVersion,c.pageIndex)};
 else if(c.type==='QUOTE_PAGE'){
 const q=(await db.query('SELECT q.* FROM order_quotes q WHERE q.id=$1 AND ((q.origin_kind=\'device\' AND q.origin_id=$2) OR EXISTS(SELECT 1 FROM order_authority o WHERE o.quote_id=q.id AND o.target_device_id=$2))',[c.quoteId,a.device])).rows[0];if(!q)fail('RESOURCE_NOT_FOUND',404);value={page:linePage(q,c.pageIndex)};
 }else if(c.type==='ORDER_DISMISS'){await dismissOrder(db,a.merchant,a.device,c.orderId,c.orderVersion,c.screenGeneration);value={screen:await currentScreen(db,a.merchant,a.device)};
 }else if(c.type==='ORDER_CANCEL'){await cancelUnpaidOrder(db,a.merchant,a.device,c.orderId,c.orderVersion,c.screenGeneration,'device:'+a.device);value={screen:await currentScreen(db,a.merchant,a.device)};
 }else{
 const s=(await db.query('SELECT * FROM device_screen_state WHERE device_id=$1 FOR UPDATE',[a.device])).rows[0];const d=(await db.query('SELECT * FROM devices WHERE id=$1',[a.device])).rows[0];if(String(s.screen_generation)!==c.expectedScreenGeneration)fail('DEVICE_BUSY');if('expectedAssignmentGeneration' in c&&String(d.assignment_generation)!==c.expectedAssignmentGeneration)fail('ASSIGNMENT_CHANGED');
 if(c.type==='CART_OPEN'){
 if(s.kind!=='idle')fail('DEVICE_BUSY');let saved:{productId:string;qty:number}[]=[];if(c.recoverSessionId){const recovered=(await db.query('SELECT * FROM device_sessions WHERE device_id=$1 AND id=$2 AND ended_at IS NOT NULL',[a.device,c.recoverSessionId])).rows[0];if(!recovered)fail('RESOURCE_NOT_FOUND',404);if((await db.query('SELECT 1 FROM order_quotes q JOIN order_authority o ON o.quote_id=q.id WHERE q.session_id=$1',[c.recoverSessionId])).rowCount)fail('ORDER_NOT_RELEASABLE');saved=recovered.cart;}
 if((await db.query('SELECT 1 FROM device_sessions WHERE id=$1',[c.sessionId])).rowCount)fail('COMMAND_CONFLICT');await db.query('INSERT INTO device_sessions(merchant_id,id,device_id,assignment_generation,cart) VALUES($1,$2,$3,$4,$5)',[a.merchant,c.sessionId,a.device,d.assignment_generation,JSON.stringify(saved)]);await db.query("UPDATE device_screen_state SET kind='cart',session_id=$2,screen_generation=screen_generation+1,lease_until=clock_timestamp()+interval '120 seconds' WHERE device_id=$1",[a.device,c.sessionId]);
 }else{
 if(s.kind!=='cart'||s.session_id!==c.sessionId)fail('LEASE_EXPIRED');const session=(await db.query('SELECT * FROM device_sessions WHERE device_id=$1 AND id=$2',[a.device,c.sessionId])).rows[0];if(String(session.assignment_generation)!==String(d.assignment_generation))fail('ASSIGNMENT_CHANGED');const expected=c.type==='CART_SET'?c.expectedCartVersion:c.cartVersion;if(String(session.cart_version)!==expected)fail('CART_VERSION_CONFLICT');
 if(c.type==='CART_SET'){const items=draftItems(c.items);const ids=items.map(i=>i.productId);if(ids.length!==(await db.query('SELECT id FROM products WHERE id=ANY($1::uuid[])',[ids])).rowCount)fail('RESOURCE_NOT_FOUND',404);await db.query('UPDATE device_sessions SET cart=$2,cart_version=cart_version+CASE WHEN cart<>$2::jsonb THEN 1 ELSE 0 END,review_quote_id=NULL WHERE id=$1',[c.sessionId,JSON.stringify(items)]);await db.query("UPDATE device_screen_state SET lease_until=clock_timestamp()+interval '120 seconds' WHERE device_id=$1",[a.device]);}
 if(c.type==='CART_REVIEW'){const route=await resolveRoute(db,a.merchant,'device',a.device);const q=await captureQuote(db,a.merchant,{kind:'device',id:a.device,sessionId:c.sessionId,cartVersion:c.cartVersion},session.cart,route.authority);if(q.price_version_id!==c.expectedPriceVersion)fail('PRICE_VERSION_CHANGED');await db.query('UPDATE device_sessions SET review_quote_id=$2 WHERE id=$1',[c.sessionId,q.id]);value={quote:deviceQuote(q),page:linePage(q,0)};}
 if(c.type==='CART_RELEASE'){await db.query('UPDATE device_sessions SET ended_at=clock_timestamp() WHERE id=$1',[c.sessionId]);await db.query("UPDATE device_screen_state SET kind='idle',session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[a.device]);}
 }if(value===undefined)value={screen:await currentScreen(db,a.merchant,a.device)};
 }
 if(!value)fail('INTERNAL_ERROR',500);const result:DeviceResult={ok:true,value};if(Buffer.byteLength(JSON.stringify(result))>6400)fail('FRAME_TOO_LARGE',422);if(!['ACK','CATALOG_PAGE','QUOTE_PAGE','SESSION_SYNC'].includes(c.type))await db.query('INSERT INTO device_command_results(merchant_id,device_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',[a.merchant,a.device,c.requestId,digest,result]);await db.query('RELEASE SAVEPOINT device_command');return response(db,a,c,result);
 }catch(error){if(!(error instanceof RequestError))throw error;await db.query('ROLLBACK TO SAVEPOINT device_command');const result:DeviceResult={ok:false,error:error.view};if(!['ACK','CATALOG_PAGE','QUOTE_PAGE','SESSION_SYNC'].includes(c.type))await db.query('INSERT INTO device_command_results(merchant_id,device_id,request_id,request_hash,result) VALUES($1,$2,$3,$4,$5)',[a.merchant,a.device,c.requestId,digest,result]);return response(db,a,c,result);}
}
async function response(db:pg.PoolClient,a:DeviceActor,c:DeviceCommand,result:DeviceResult):Promise<DeviceCommandResult>{const d=(await db.query('SELECT d.assignment_generation::text,s.screen_generation::text FROM devices d JOIN device_screen_state s ON s.device_id=d.id AND s.merchant_id=d.merchant_id WHERE d.id=$1',[a.device])).rows[0];return {schemaVersion:2,type:'COMMAND_RESULT',requestId:c.requestId,connectionGeneration:a.connectionGeneration,screenGeneration:d.screen_generation,assignmentGeneration:d.assignment_generation,result};}
