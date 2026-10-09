import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,tenant,audit} from './db';
import {cart,uuid,fail,routingLock} from './authority';
import {effectiveCatalog,captureQuote,quoteView} from './catalog';
import {resolveRoute,createRoutedOrder,orderView,dismissOrder,streamEvent} from './orders';
import {currentScreen} from './device-commands';
import {ensureDevice,expireCart} from './registry';
import type {OrderRow,QuoteRow} from './types';
const capability=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
interface Entry {id:string;merchant_id:string;device_id:string;table_id:string;assignment_generation:string;auth_generation:string;entry_token:string}
interface Visit {id:string;access_token:string;session_id:string|null;review_quote_id:string|null;order_id:string|null;expires_at:Date}
async function currentEntry(db:pg.PoolClient,e:Entry){
 const found=(await db.query('SELECT 1 FROM devices d JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.merchant_id=$1 AND d.id=$2 AND d.table_id=$3 AND d.assignment_generation=$4 AND d.auth_generation=$5 AND d.revoked_at IS NULL AND t.retired_at IS NULL',[e.merchant_id,e.device_id,e.table_id,e.assignment_generation,e.auth_generation])).rowCount;
 if(!found)fail('ASSIGNMENT_CHANGED',409);
 await ensureDevice(db,e.merchant_id,e.device_id);await expireCart(db,e.merchant_id,e.device_id);
}
async function occupancy(db:pg.PoolClient,e:Entry,visit?:Visit){
 const state=(await db.query('SELECT s.*,coalesce(p.connected_until>clock_timestamp(),false) AS online FROM device_screen_state s LEFT JOIN device_presence p USING(merchant_id,device_id) WHERE s.merchant_id=$1 AND s.device_id=$2',[e.merchant_id,e.device_id])).rows[0];
 return {state,available:state?.kind==='idle'||state?.kind==='cart'&&state.session_id===visit?.session_id,online:!!state?.online};
}
function liveVisit(v:Visit){if(v.expires_at.getTime()<=Date.now())fail('LEASE_EXPIRED');}
async function view(db:pg.PoolClient,e:Entry,v:Visit){
 if(v.order_id){const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[e.merchant_id,v.order_id])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);return {kind:'order' as const,order:await orderView(db,o,true)};}
 liveVisit(v);await currentEntry(db,e);const o=await occupancy(db,e,v);
 const quote=v.review_quote_id?(await db.query<QuoteRow>('SELECT * FROM order_quotes WHERE merchant_id=$1 AND id=$2 AND session_id=$3',[e.merchant_id,v.review_quote_id,v.session_id])).rows[0]:null;
 const leased=o.state.kind==='cart'&&o.state.session_id===v.session_id&&new Date(o.state.lease_until).getTime()>Date.now();
 return {kind:'draft' as const,expiresAt:v.expires_at.toISOString(),online:o.online,available:o.available,quote:leased&&quote?{...quoteView(quote),authority:quote.authority}:null};
}
async function publishCart(db:pg.PoolClient,e:Entry){const screen=await currentScreen(db,e.merchant_id,e.device_id);await streamEvent(db,e.merchant_id,e.device_id,e.assignment_generation,screen.screenGeneration,'CART',screen);}
export async function tableRequest(path:string,method:string,input:unknown){
 const match=path.match(/^\/api\/table\/([^/]+)(?:\/(visit)(?:\/([^/]+)(?:\/(quotes|orders|release|dismiss))?)?)?$/);if(!match)return undefined;
 const entryToken=capability.parse(match[1]);const merchant=(await pool.query('SELECT bitpos.resolve_table_entry($1) AS merchant',[entryToken])).rows[0]?.merchant;if(!merchant)fail('RESOURCE_NOT_FOUND',404);
 return tenant(merchant,async db=>{
  await routingLock(db,merchant);
  const e=(await db.query<Entry>('SELECT id,merchant_id,device_id,table_id,assignment_generation::text,auth_generation::text,entry_token FROM table_entries WHERE merchant_id=$1 AND entry_token=$2',[merchant,entryToken])).rows[0];if(!e)fail('RESOURCE_NOT_FOUND',404);
  if(!match[2]&&method==='GET'){
   await currentEntry(db,e);const o=await occupancy(db,e);const menu=await effectiveCatalog(db,merchant);const table=(await db.query('SELECT label FROM merchant_tables WHERE merchant_id=$1 AND id=$2',[merchant,e.table_id])).rows[0];
   return {tableLabel:table.label,menu,online:o.online,available:o.available};
  }
  if(match[2]&&!match[3]&&method==='POST'){
   const d=z.object({requestId:uuid}).strict().parse(input);await currentEntry(db,e);
   const old=(await db.query<Visit>('SELECT * FROM table_visits WHERE merchant_id=$1 AND entry_id=$2 AND request_id=$3',[merchant,e.id,d.requestId])).rows[0];if(old)return {visitToken:old.access_token,state:await view(db,e,old)};
   if((await db.query("SELECT count(*)::int AS n FROM table_visits WHERE merchant_id=$1 AND entry_id=$2 AND created_at>clock_timestamp()-interval '1 minute'",[merchant,e.id])).rows[0].n>=30)fail('DEVICE_BUSY',429);
   const v=(await db.query<Visit>('INSERT INTO table_visits(merchant_id,entry_id,request_id) VALUES($1,$2,$3) RETURNING *',[merchant,e.id,d.requestId])).rows[0];return {visitToken:v.access_token,state:await view(db,e,v)};
  }
  if(!match[3])fail('RESOURCE_NOT_FOUND',404);
  const v=(await db.query<Visit>('SELECT * FROM table_visits WHERE merchant_id=$1 AND entry_id=$2 AND access_token=$3 FOR UPDATE',[merchant,e.id,capability.parse(match[3])])).rows[0];if(!v)fail('RESOURCE_NOT_FOUND',404);
  const action=match[4];
  if(!action&&method==='GET')return view(db,e,v);
  if(method!=='POST')fail('RESOURCE_NOT_FOUND',404);
  if(action==='orders'){
   const d=z.object({quoteId:uuid,priceVersion:uuid,idempotencyKey:uuid}).strict().parse(input);
   if(!v.session_id||v.review_quote_id!==d.quoteId)fail('QUOTE_CHANGED');
   if(!v.order_id){liveVisit(v);await currentEntry(db,e);}
   const session=(await db.query('SELECT cart_version::text FROM device_sessions WHERE merchant_id=$1 AND id=$2 AND public_visit_id=$3',[merchant,v.session_id,v.id])).rows[0];if(!session)fail('LEASE_EXPIRED');
   const state=(await db.query('SELECT screen_generation::text FROM device_screen_state WHERE merchant_id=$1 AND device_id=$2',[merchant,e.device_id])).rows[0];
   // Factory replay runs before current routing/freshness checks, preserving unknown-outcome recovery.
   const created=await createRoutedOrder(db,merchant,'device',e.device_id,{...d,sessionId:v.session_id,cartVersion:session.cart_version,expectedScreenGeneration:state.screen_generation});
   if(v.order_id&&v.order_id!==created.order.id)fail('IDEMPOTENCY_CONFLICT');
   if(!v.order_id){await db.query('UPDATE table_visits SET order_id=$3 WHERE merchant_id=$1 AND id=$2',[merchant,v.id,created.order.id]);await audit(db,merchant,'public-table-guest','order.create',created.order.id);}
   const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,created.order.id])).rows[0];return {kind:'order' as const,order:await orderView(db,o,true),replayed:created.replayed};
  }
  if(action==='dismiss'){
   z.object({}).strict().parse(input);if(!v.order_id)fail('ORDER_NOT_RELEASABLE');
   const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,v.order_id])).rows[0];const s=(await db.query('SELECT * FROM device_screen_state WHERE merchant_id=$1 AND device_id=$2',[merchant,e.device_id])).rows[0];
   if(s.kind==='idle')return {dismissed:true};
   await dismissOrder(db,merchant,e.device_id,v.order_id,o.version,String(s.screen_generation));await audit(db,merchant,'public-table-guest','order.dismiss',v.order_id);await publishCart(db,e);return {dismissed:true};
  }
  liveVisit(v);await currentEntry(db,e);if(v.order_id)fail('ORDER_NOT_PAYABLE');
  const o=await occupancy(db,e,v);
  if(action==='release'){
   z.object({}).strict().parse(input);if(o.state.kind==='cart'&&o.state.session_id===v.session_id){await db.query('UPDATE device_sessions SET ended_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,v.session_id]);await db.query("UPDATE device_screen_state SET kind='idle',session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[merchant,e.device_id]);await publishCart(db,e);}await db.query('UPDATE table_visits SET session_id=NULL,review_quote_id=NULL WHERE merchant_id=$1 AND id=$2',[merchant,v.id]);return {released:true};
  }
  if(action!=='quotes')fail('RESOURCE_NOT_FOUND',404);
  const d=z.object({items:cart.refine(items=>items.length>0)}).strict().parse(input);if(!o.online)fail('DEVICE_OFFLINE',503);if(!o.available)fail('DEVICE_BUSY');
  const route=await resolveRoute(db,merchant,'device',e.device_id);
  if(o.state.kind==='idle'){
   v.session_id=randomUUID();await db.query('INSERT INTO device_sessions(merchant_id,id,device_id,assignment_generation,public_visit_id) VALUES($1,$2,$3,$4,$5)',[merchant,v.session_id,e.device_id,e.assignment_generation,v.id]);await db.query("UPDATE device_screen_state SET kind='cart',session_id=$3,lease_until=clock_timestamp()+interval '120 seconds',screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[merchant,e.device_id,v.session_id]);
  }
  const session=(await db.query('UPDATE device_sessions SET cart=$3,cart_version=cart_version+CASE WHEN cart<>$3::jsonb THEN 1 ELSE 0 END,review_quote_id=NULL WHERE merchant_id=$1 AND id=$2 AND public_visit_id=$4 AND ended_at IS NULL RETURNING cart_version::text',[merchant,v.session_id,JSON.stringify(d.items),v.id])).rows[0];if(!session)fail('LEASE_EXPIRED');
  const q=await captureQuote(db,merchant,{kind:'device',id:e.device_id,sessionId:v.session_id!,cartVersion:session.cart_version},d.items,route.authority);
  await db.query('UPDATE device_sessions SET review_quote_id=$3 WHERE merchant_id=$1 AND id=$2',[merchant,v.session_id,q.id]);await db.query("UPDATE device_screen_state SET lease_until=clock_timestamp()+interval '120 seconds' WHERE merchant_id=$1 AND device_id=$2",[merchant,e.device_id]);await db.query('UPDATE table_visits SET session_id=$3,review_quote_id=$4 WHERE merchant_id=$1 AND id=$2',[merchant,v.id,v.session_id,q.id]);await publishCart(db,e);
  return {quote:{...quoteView(q),authority:route.authority},expiresAt:v.expires_at.toISOString()};
 });
}
