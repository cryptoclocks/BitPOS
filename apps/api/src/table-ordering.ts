import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {pool,tenant,audit} from './db';
import {cart,uuid,fail,routingLock} from './authority';
import {effectiveCatalog,captureQuote,quoteView} from './catalog';
import {resolveRoute,createRoutedOrder,orderView,dismissOrder,streamEvent,releaseEligible} from './orders';
import {currentScreen} from './device-commands';
import {ensureDevice,expireCart} from './registry';
import type {OrderRow,QuoteRow} from './types';
import {claimPromotionOffer,scopePromotionMenu} from './scoped-offers';
import {hash} from '../../../packages/domain/src/index';
import {assertAssetDescriptor} from '../../../packages/domain/src/payment-assets';
import {collectionPolicy,freezeCoffeeQuote,coffeeQuoteView,repeatRequest,type RepeatLimit} from './coffee-order-constraints';
import {grantReviewProof,reviewedGrantPayment} from './coffee-grant-review';
import {tableOccupancyView,assertVisitOccupancy} from './table-occupancy';
import {rememberVisitRecipientProof,bindVisitRecipient,personalPromotionMenu} from './personal-promotions';
import {currentPromotionPlaylist} from './promotion-playlists';
const capability=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
interface Entry {id:string;merchant_id:string;device_id:string;table_id:string;assignment_generation:string;auth_generation:string;entry_token:string}
interface Visit {id:string;access_token:string;session_id:string|null;review_quote_id:string|null;order_id:string|null;expires_at:Date;promotion_offer_token:string|null}
async function currentEntry(db:pg.PoolClient,e:Entry){
 const found=(await db.query('SELECT 1 FROM devices d JOIN merchant_tables t ON t.merchant_id=d.merchant_id AND t.id=d.table_id WHERE d.merchant_id=$1 AND d.id=$2 AND d.table_id=$3 AND d.assignment_generation=$4 AND d.auth_generation=$5 AND d.revoked_at IS NULL AND t.retired_at IS NULL',[e.merchant_id,e.device_id,e.table_id,e.assignment_generation,e.auth_generation])).rowCount;
 if(!found)fail('ASSIGNMENT_CHANGED',409);
 await ensureDevice(db,e.merchant_id,e.device_id);await expireCart(db,e.merchant_id,e.device_id);
}
async function occupancy(db:pg.PoolClient,e:Entry,visit?:Visit){
 const state=(await db.query('SELECT s.*,coalesce(p.connected_until>clock_timestamp(),false) AS online FROM device_screen_state s LEFT JOIN device_presence p USING(merchant_id,device_id) WHERE s.merchant_id=$1 AND s.device_id=$2',[e.merchant_id,e.device_id])).rows[0];
 // A PAID bill whose receipt the device has already rendered no longer owns the table screen: the next guest may start a new order. Unpaid/ambiguous bills stay protected.
 const paid=state?.kind==='order'&&state.order_id?(await db.query<OrderRow>("SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 AND status='PAID'",[e.merchant_id,state.order_id])).rows[0]:undefined;
 const releasable=!!paid&&await releaseEligible(db,paid,e.device_id);
 return {state,paid:releasable?paid:undefined,available:state?.kind==='idle'||releasable||state?.kind==='cart'&&state.session_id===visit?.session_id,online:!!state?.online};
}
function liveVisit(v:Visit){if(v.expires_at.getTime()<=Date.now())fail('LEASE_EXPIRED');}
async function view(db:pg.PoolClient,e:Entry,v:Visit){
 if(v.order_id){const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2',[e.merchant_id,v.order_id])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);return {kind:'order' as const,order:await orderView(db,o,true)};}
 liveVisit(v);await currentEntry(db,e);await assertVisitOccupancy(db,e.merchant_id,v.id);const o=await occupancy(db,e,v);
 const quote=v.review_quote_id?(await db.query<QuoteRow>('SELECT * FROM order_quotes WHERE merchant_id=$1 AND id=$2 AND session_id=$3',[e.merchant_id,v.review_quote_id,v.session_id])).rows[0]:null;
 const leased=o.state.kind==='cart'&&o.state.session_id===v.session_id&&new Date(o.state.lease_until).getTime()>Date.now();
 return {kind:'draft' as const,expiresAt:v.expires_at.toISOString(),online:o.online,available:o.available,occupancy:await tableOccupancyView(db,e.merchant_id,e.table_id,v.id),menu:await personalPromotionMenu(db,e.merchant_id,await scopePromotionMenu(db,e.merchant_id,await effectiveCatalog(db,e.merchant_id,e.table_id),leased?v.session_id:null),leased?v.session_id:null),quote:leased&&quote?{...await coffeeQuoteView(db,e.merchant_id,quote.id,quoteView(quote)),authority:quote.authority}:null};
}
async function publishCart(db:pg.PoolClient,e:Entry){const screen=await currentScreen(db,e.merchant_id,e.device_id),promotionPlaylist=await currentPromotionPlaylist(db,e.merchant_id,e.device_id);await streamEvent(db,e.merchant_id,e.device_id,e.assignment_generation,screen.screenGeneration,'CART',{...screen,promotionPlaylist});}
export async function tableRequest(path:string,method:string,input:unknown){
 const match=path.match(/^\/api\/table\/([^/]+)(?:\/(visit)(?:\/([^/]+)(?:\/(quotes|orders|release|dismiss|repeat-quotes))?)?)?$/);if(!match)return undefined;
 const entryToken=capability.parse(match[1]);const merchant=(await pool.query('SELECT bitpos.resolve_table_entry($1) AS merchant',[entryToken])).rows[0]?.merchant;if(!merchant)fail('RESOURCE_NOT_FOUND',404);
 return tenant(merchant,async db=>{
  await routingLock(db,merchant);
  const e=(await db.query<Entry>('SELECT id,merchant_id,device_id,table_id,assignment_generation::text,auth_generation::text,entry_token FROM table_entries WHERE merchant_id=$1 AND entry_token=$2',[merchant,entryToken])).rows[0];if(!e)fail('RESOURCE_NOT_FOUND',404);
  if(!match[2]&&method==='GET'){
   await currentEntry(db,e);const o=await occupancy(db,e);const menu=await effectiveCatalog(db,merchant,e.table_id);const table=(await db.query('SELECT label FROM merchant_tables WHERE merchant_id=$1 AND id=$2',[merchant,e.table_id])).rows[0];
   return {tableLabel:table.label,menu,online:o.online,available:o.available,occupancy:await tableOccupancyView(db,merchant,e.table_id),collectionPolicy:await collectionPolicy(db,merchant)};
  }
  if(match[2]&&!match[3]&&method==='POST'){
   const d=z.object({requestId:uuid,offer:capability.optional(),sourceVisitToken:capability.optional(),customerSessionToken:capability.optional()}).strict().parse(input);await currentEntry(db,e);
   const proof={sourceVisitToken:d.sourceVisitToken,customerSessionToken:d.customerSessionToken};
   const old=(await db.query<Visit>('SELECT * FROM table_visits WHERE merchant_id=$1 AND entry_id=$2 AND request_id=$3',[merchant,e.id,d.requestId])).rows[0];if(old){if(old.promotion_offer_token!==(d.offer??null))fail('IDEMPOTENCY_CONFLICT');if(d.sourceVisitToken||d.customerSessionToken)await rememberVisitRecipientProof(db,merchant,old.id,proof);return {visitToken:old.access_token,state:await view(db,e,old)};}
   if(d.offer&&!(await db.query("SELECT 1 FROM promotion_targets t JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id WHERE t.merchant_id=$1 AND t.entry_id=$2 AND t.offer_token=$3 AND t.state IN ('DELIVERED','RENDERED') AND t.expires_at>clock_timestamp() AND c.state='APPROVED' AND c.starts_at<=clock_timestamp() AND c.expires_at>clock_timestamp() AND bitpos.promotion_binding_current(t.merchant_id,t.id)",[merchant,e.id,d.offer])).rowCount)fail('PROMOTION_OFFER_INVALID');
   if((await db.query("SELECT count(*)::int AS n FROM table_visits WHERE merchant_id=$1 AND entry_id=$2 AND created_at>clock_timestamp()-interval '1 minute'",[merchant,e.id])).rows[0].n>=30)fail('DEVICE_BUSY',429);
   const v=(await db.query<Visit>('INSERT INTO table_visits(merchant_id,entry_id,request_id,promotion_offer_token) VALUES($1,$2,$3,$4) RETURNING *',[merchant,e.id,d.requestId,d.offer??null])).rows[0];if(d.sourceVisitToken||d.customerSessionToken)await rememberVisitRecipientProof(db,merchant,v.id,proof);return {visitToken:v.access_token,state:await view(db,e,v)};
  }
  if(!match[3])fail('RESOURCE_NOT_FOUND',404);
  const v=(await db.query<Visit>('SELECT * FROM table_visits WHERE merchant_id=$1 AND entry_id=$2 AND access_token=$3 FOR UPDATE',[merchant,e.id,capability.parse(match[3])])).rows[0];if(!v)fail('RESOURCE_NOT_FOUND',404);
  const action=match[4];
  if(!action&&method==='GET')return view(db,e,v);
  if(method!=='POST')fail('RESOURCE_NOT_FOUND',404);
  if(action==='orders'){
   const d=z.object({quoteId:uuid,priceVersion:uuid,idempotencyKey:uuid}).strict().parse(input);
   if(!v.session_id||v.review_quote_id!==d.quoteId)fail('QUOTE_CHANGED');
   if(!v.order_id){liveVisit(v);await currentEntry(db,e);await assertVisitOccupancy(db,merchant,v.id);}
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
  liveVisit(v);await currentEntry(db,e);await assertVisitOccupancy(db,merchant,v.id);if(v.order_id)fail('ORDER_NOT_PAYABLE');
  const o=await occupancy(db,e,v);
  if(action==='release'){
   z.object({}).strict().parse(input);if(o.state.kind==='cart'&&o.state.session_id===v.session_id){await db.query('UPDATE device_sessions SET ended_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,v.session_id]);await db.query("UPDATE device_screen_state SET kind='idle',session_id=NULL,lease_until=NULL,screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[merchant,e.device_id]);await publishCart(db,e);}await db.query('UPDATE table_visits SET session_id=NULL,review_quote_id=NULL WHERE merchant_id=$1 AND id=$2',[merchant,v.id]);return {released:true};
  }
  if(action!=='quotes'&&action!=='repeat-quotes')fail('RESOURCE_NOT_FOUND',404);
  let d:{items:{productId:string;qty:number}[];collection:'table'|'counter';confirmJoin:boolean;delegation?:z.infer<typeof grantReviewProof>};
  let repeat:RepeatLimit|undefined;let repeatId:string|undefined;let repeatHash:string|undefined;
  if(action==='repeat-quotes'){
   const inputRepeat=repeatRequest.parse(input);repeatId=inputRepeat.requestId;repeatHash=hash(JSON.stringify(inputRepeat));
   const previous=(await db.query('SELECT * FROM repeat_quote_requests WHERE merchant_id=$1 AND visit_id=$2 AND request_id=$3',[merchant,v.id,repeatId])).rows[0];
   if(previous){if(previous.input_hash!==repeatHash)fail('IDEMPOTENCY_CONFLICT');const q=(await db.query<QuoteRow>('SELECT * FROM order_quotes WHERE merchant_id=$1 AND id=$2',[merchant,previous.quote_id])).rows[0];return {quote:{...await coffeeQuoteView(db,merchant,q.id,quoteView(q)),authority:q.authority},expiresAt:v.expires_at.toISOString()};}
   const source=(await db.query('SELECT o.id,o.status,a.quote_id,q.cart,c.collection FROM table_visits s JOIN orders o ON o.merchant_id=s.merchant_id AND o.id=s.order_id JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id LEFT JOIN quote_coffee_constraints c ON c.merchant_id=q.merchant_id AND c.quote_id=q.id WHERE s.merchant_id=$1 AND s.access_token=$2 AND s.id<>$3 AND o.status=\'PAID\' AND EXISTS(SELECT 1 FROM payments p WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id AND p.state=\'SETTLED\')',[merchant,inputRepeat.sourceVisitToken,v.id])).rows[0];if(!source)fail('REPEAT_SOURCE_UNAVAILABLE',404);
   const accepted=(await db.query('SELECT r.descriptor,m.policy FROM merchant_payment_assets m JOIN payment_assets r ON r.asset_id=m.asset_id WHERE m.merchant_id=$1 AND m.asset_id=$2 AND m.enabled AND r.enabled AND r.verified_at IS NOT NULL',[merchant,inputRepeat.assetId])).rows[0];if(!accepted)fail('PAYMENT_ASSET_UNAVAILABLE',422);assertAssetDescriptor(accepted.descriptor);
   const expiry=Date.parse(inputRepeat.expiresAt);if(expiry<=Date.now()||expiry>Date.now()+300000)fail('REPEAT_CAP_EXPIRED',422);
   const recipient=(await db.query('SELECT treasury FROM merchants WHERE id=$1',[merchant])).rows[0].treasury;
   repeat={sourceOrderId:source.id,asset:accepted.descriptor,recipient,maxAtomic:inputRepeat.maxAtomic,expiresAt:inputRepeat.expiresAt};
   d={items:cart.parse(source.cart),collection:source.collection??'table',confirmJoin:inputRepeat.confirmJoin,delegation:inputRepeat.delegation};
  }else d=z.object({items:cart.refine(items=>items.length>0),collection:z.enum(['table','counter']).default('table'),delegation:grantReviewProof.optional(),confirmJoin:z.boolean().default(false)}).strict().parse(input);
  if(!o.online)fail('DEVICE_OFFLINE',503);if(!o.available)fail('DEVICE_BUSY');
  const group=await tableOccupancyView(db,merchant,e.table_id,v.id);
  if(group.active&&!group.joined&&!d.confirmJoin)fail('TABLE_JOIN_CONFIRMATION_REQUIRED');
  const route=await resolveRoute(db,merchant,'device',e.device_id);
  if(o.paid){
   await dismissOrder(db,merchant,e.device_id,o.paid.id,o.paid.version,String(o.state.screen_generation));await audit(db,merchant,'public-table-guest','order.dismiss_paid_for_new_order',o.paid.id);o.state={...o.state,kind:'idle'};
  }
  if(o.state.kind==='idle'){
   v.session_id=randomUUID();await db.query('INSERT INTO device_sessions(merchant_id,id,device_id,assignment_generation,public_visit_id) VALUES($1,$2,$3,$4,$5)',[merchant,v.session_id,e.device_id,e.assignment_generation,v.id]);await db.query("UPDATE device_screen_state SET kind='cart',session_id=$3,lease_until=clock_timestamp()+interval '120 seconds',screen_generation=screen_generation+1 WHERE merchant_id=$1 AND device_id=$2",[merchant,e.device_id,v.session_id]);
  }
  const session=(await db.query('UPDATE device_sessions SET cart=$3,cart_version=cart_version+CASE WHEN cart<>$3::jsonb THEN 1 ELSE 0 END,review_quote_id=NULL WHERE merchant_id=$1 AND id=$2 AND public_visit_id=$4 AND ended_at IS NULL RETURNING cart_version::text',[merchant,v.session_id,JSON.stringify(d.items),v.id])).rows[0];if(!session)fail('LEASE_EXPIRED');
  if(v.promotion_offer_token)await claimPromotionOffer(db,merchant,v.promotion_offer_token,v.session_id!,v.id);
  const origin={kind:'device' as const,id:e.device_id,sessionId:v.session_id!,cartVersion:session.cart_version};
  let q=await captureQuote(db,merchant,origin,d.items,route.authority);
  await bindVisitRecipient(db,merchant,v.id);
  const personal=await personalPromotionMenu(db,merchant,await effectiveCatalog(db,merchant,e.table_id),v.session_id);
  if(q.lines.some(line=>personal.products.find(p=>p.id===line.productId)?.personalPromotion?.targetId!==line.personalPromotion?.targetId))q=await captureQuote(db,merchant,origin,d.items,route.authority);
  await freezeCoffeeQuote(db,merchant,q,d.collection,repeat,d.delegation?await reviewedGrantPayment(db,merchant,d.delegation,q):undefined);
  if(repeatId)await db.query('INSERT INTO repeat_quote_requests(merchant_id,visit_id,request_id,input_hash,quote_id) VALUES($1,$2,$3,$4,$5)',[merchant,v.id,repeatId,repeatHash,q.id]);
  await db.query('UPDATE device_sessions SET review_quote_id=$3 WHERE merchant_id=$1 AND id=$2',[merchant,v.session_id,q.id]);await db.query("UPDATE device_screen_state SET lease_until=clock_timestamp()+interval '120 seconds' WHERE merchant_id=$1 AND device_id=$2",[merchant,e.device_id]);await db.query('UPDATE table_visits SET session_id=$3,review_quote_id=$4 WHERE merchant_id=$1 AND id=$2',[merchant,v.id,v.session_id,q.id]);await publishCart(db,e);
  return {quote:{...await coffeeQuoteView(db,merchant,q.id,quoteView(q)),authority:route.authority},expiresAt:v.expires_at.toISOString()};
 });
}
