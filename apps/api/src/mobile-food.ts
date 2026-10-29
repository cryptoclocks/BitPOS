import type pg from 'pg';
import {z} from 'zod';
import {hash} from '../../../packages/domain/src/index';
import type {Settlement,EffectiveLine} from '../../../packages/contracts/src/index';
import {MobileBranchesSchema,MobileMenuSchema,MobileProductSchema,MobileFoodQuoteRequestSchema,MobileFoodOrderRequestSchema,MobileFoodQuoteSchema,MobileFoodOrderSchema,MobileFoodOrderResultSchema,MobileFoodOrdersSchema,MobileFoodOrderSummarySchema,MobileFoodEventsSchema,MobileSettlementSchema,type MobileBranch,type MobileFoodOrder,type MobileFoodOrderSummary,type MobileProduct} from '../../../packages/contracts/src/mobile-v1.generated';
import {pool,tenant,audit} from './db';
import {mobilePrincipal,type MobilePrincipal} from './mobile-auth';
import {fail,routingLock,uuid,integer} from './authority';
import {captureQuote,effectiveCatalog,quoteView,validateQuote} from './catalog';
import {createQuotedOrder,orderView,submission,emitOrder} from './orders';
import {fulfillmentViews} from './fulfillment';
import type {QuoteRow,OrderRow} from './types';
import {closeTerminatedOnlineOrder} from './order-closure';
import {configuredQuote} from './configured-food';
import {productOptionsAt} from './online-options';
import {MobileFoodRefundsSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {MobileDeliveryQuoteRequestSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {MobileCustomerDeliveryPolicySchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {FoodMerchantAcceptanceCommandSchema} from '../../../packages/contracts/src/mobile-v1.generated';
import {deliveryProjection,deliverySnapshot} from './food-delivery';

type Branch={merchant_id:string;profile:MobileBranch};
async function publicBranch(id:string):Promise<Branch>{
 const row=(await pool.query<Branch>("SELECT * FROM bitpos.mobile_public_branches($1,NULL,1,'','all')",[id])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);return row;
}
async function enabledBranch(db:pg.PoolClient,merchant:string,id:string){
 const row=(await db.query('SELECT * FROM marketplace_branches WHERE merchant_id=$1 AND id=$2 AND enabled',[merchant,id])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);return row;
}
async function customerLink(db:pg.PoolClient,merchant:string,account:string){
 // Merchant routing lock serializes first-link creation with ordering. No CRM
 // phone/email match can silently grant ownership of historical counter orders.
 const linked=(await db.query<{customer_id:string}>('SELECT customer_id FROM mobile_customer_links WHERE merchant_id=$1 AND account_id=$2',[merchant,account])).rows[0];
 if(linked)return linked.customer_id;
 const customer=(await db.query<{id:string}>('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[merchant])).rows[0];
 await db.query('INSERT INTO mobile_customer_links(account_id,merchant_id,customer_id) VALUES($1,$2,$3)',[account,merchant,customer.id]);return customer.id;
}
function settlementProjection(s:Settlement){return MobileSettlementSchema.parse({money:{currency:s.currency,decimals:s.decimals,amountMinor:s.amountMinor},recipient:s.recipient,network:s.network,genesisHash:s.genesisHash,mint:s.mint,tokenProgram:s.tokenProgram,testToken:s.testToken});}
const linesProjection=(lines:EffectiveLine[])=>lines.map(l=>({productId:l.productId,name:l.name,nameEn:l.nameEn,qty:l.qty,unitPrice:l.unitPrice,basePrice:l.basePrice}));
async function quoteProjection(db:pg.PoolClient,q:QuoteRow,branchId:string){
 const v=quoteView(q),{snapshot:configured}=await configuredQuote(db,q.merchant_id,q.id);
 return MobileFoodQuoteSchema.parse({id:v.id,merchantId:q.merchant_id,branchId,priceVersion:v.priceVersion,pricingRevision:v.pricingRevision,quotedAt:v.quotedAt,validUntil:v.validUntil,lines:linesProjection(v.lines),subtotal:configured.subtotal,discount:configured.discount,fees:configured.fees,tax:configured.tax,total:v.total,settlement:settlementProjection(v.settlement),configured,delivery:q.authority.serving.kind==='delivery'?deliveryProjection(await deliverySnapshot(db,q.merchant_id,q.id)):null});
}
export async function mobileOrderProjection(db:pg.PoolClient,o:OrderRow,account?:string):Promise<MobileFoodOrder>{
 await db.query('SELECT id FROM orders WHERE merchant_id=$1 AND id=$2 FOR SHARE',[o.merchant_id,o.id]);
 const lifecycle=(await db.query('SELECT * FROM online_food_orders WHERE merchant_id=$1 AND order_id=$2 AND ($3::uuid IS NULL OR account_id=$3)',[o.merchant_id,o.id,account??null])).rows[0];
 if(!lifecycle)fail('RESOURCE_NOT_FOUND',404);
 const v=await orderView(db,o,true,'mobile-page'),k=(await fulfillmentViews(db,o.merchant_id,[o.id])).get(o.id)!;
 const configured=v.configuredFood??null,refunds=v.onlineAcceptance!.refunds;
 const quoteId=v.authority.serving.kind==='delivery'?(await db.query<{quote_id:string}>('SELECT quote_id FROM order_authority WHERE merchant_id=$1 AND order_id=$2',[o.merchant_id,o.id])).rows[0].quote_id:null;
 return MobileFoodOrderSchema.parse({id:o.id,merchantId:o.merchant_id,branchId:lifecycle.branch_id,status:v.status,version:v.version,acceptanceStatus:lifecycle.acceptance_status,acceptanceVersion:lifecycle.acceptance_version,acceptanceDeadline:new Date(lifecycle.acceptance_deadline).toISOString(),acceptanceReason:lifecycle.decision_reason,eventSequence:String(lifecycle.event_sequence),refunds:refunds.slice(0,30),nextRefundCursor:refunds.length>30?refunds[29].id:null,fulfillmentStatus:k.status,fulfillmentVersion:k.version,createdAt:v.createdAt,quoteExpiresAt:v.quoteExpiresAt,total:v.pricing.total,settlement:settlementProjection(v.settlement),lines:linesProjection(v.pricing.lines),paymentUrl:v.paymentUrl,configured,delivery:quoteId?deliveryProjection(await deliverySnapshot(db,o.merchant_id,quoteId)):null,preparation:v.onlineAcceptance!.preparation});
}
export async function decideOnlineOrder(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:string,input:unknown){
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 const data=FoodMerchantAcceptanceCommandSchema.parse(input),digest=hash(JSON.stringify(data));await routingLock(db,merchant);
 const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,orderId])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);
 const f=(await db.query('SELECT *,acceptance_deadline>clock_timestamp() AS timely FROM online_food_orders WHERE merchant_id=$1 AND order_id=$2 FOR UPDATE',[merchant,orderId])).rows[0];if(!f)fail('RESOURCE_NOT_FOUND',404);
 const old=(await db.query('SELECT * FROM online_acceptance_requests WHERE merchant_id=$1 AND order_id=$2 AND idempotency_key=$3',[merchant,orderId,data.idempotencyKey])).rows[0];
 if(old){if(old.request_hash!==digest)fail('IDEMPOTENCY_CONFLICT');return old.result;}
 if(f.acceptance_version!==data.expectedVersion)fail('ACCEPTANCE_VERSION_CONFLICT');
 if(f.acceptance_status!=='PENDING'||!f.timely||data.status==='ACCEPTED'&&['EXPIRED','RECOVERY'].includes(o.status))fail('ACCEPTANCE_UNAVAILABLE');
 await db.query("UPDATE online_food_orders SET acceptance_status=$3,acceptance_version=acceptance_version+1,decision_by=$4,decision_reason=$5,preparation_minutes=$6 WHERE merchant_id=$1 AND order_id=$2",[merchant,orderId,data.status,actor,data.status==='REJECTED'?data.reason.trim():null,data.status==='ACCEPTED'?data.preparationMinutes:null]);
 if(data.status==='REJECTED'){
  await closeTerminatedOnlineOrder(db,merchant,orderId,actor);
  await db.query('SELECT bitpos.ensure_online_decision_refunds($1,$2)',[merchant,orderId]);
 }
 await audit(db,merchant,actor,data.status==='ACCEPTED'?'order.online.accepted':'order.online.rejected',orderId);
 const result={acceptance:{status:data.status,version:f.acceptance_version+1}};
 await db.query('INSERT INTO online_acceptance_requests(merchant_id,order_id,idempotency_key,request_hash,result) VALUES($1,$2,$3,$4,$5)',[merchant,orderId,data.idempotencyKey,digest,result]);return result;
}
export async function reconcileOnlineAcceptance(db:pg.PoolClient,merchant:string,orderId:string){
 await routingLock(db,merchant);
 await db.query('SELECT id FROM orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,orderId]);
 const f=(await db.query('SELECT *,acceptance_deadline<=clock_timestamp() AS due FROM online_food_orders WHERE merchant_id=$1 AND order_id=$2 FOR UPDATE',[merchant,orderId])).rows[0];
 if(!f)return;
 if(f.acceptance_status==='PENDING'&&f.due){
  await db.query("UPDATE online_food_orders SET acceptance_status='TIMED_OUT',acceptance_version=acceptance_version+1,decision_reason='ACCEPTANCE_DEADLINE' WHERE merchant_id=$1 AND order_id=$2",[merchant,orderId]);
  await audit(db,merchant,'acceptance-worker','order.online.timed_out',orderId);
 }else if(!['REJECTED','TIMED_OUT'].includes(f.acceptance_status))return;
 await closeTerminatedOnlineOrder(db,merchant,orderId,'acceptance-worker');
 await db.query('SELECT bitpos.ensure_online_decision_refunds($1,$2)',[merchant,orderId]);
}
async function ownedLocations(actor:MobilePrincipal,order:string|null,cursor:string|null,limit:number){
 return (await pool.query<{merchant_id:string;order_id:string;branch_id:string}>('SELECT * FROM bitpos.mobile_owned_order_locations($1,$2,$3,$4,$5)',[actor.accountId,actor.sessionId,order,cursor,limit])).rows;
}
function cursor(url:URL){
 for(const key of url.searchParams.keys())if(key!=='cursor'||url.searchParams.getAll(key).length!==1)fail('INVALID_REQUEST',422);
 const value=url.searchParams.get('cursor');return value===null?null:uuid.parse(value);
}
export async function mobileFoodRequest(url:URL,method:string,input:unknown,bearer:string|undefined){
 const path=url.pathname;
 if(path==='/api/mobile/v1/branches'&&method==='GET'){
  for(const key of url.searchParams.keys())if(!['cursor','search','serving'].includes(key)||url.searchParams.getAll(key).length!==1)fail('INVALID_REQUEST',422);
  const after=url.searchParams.has('cursor')?uuid.parse(url.searchParams.get('cursor')):null;
  const search=z.string().trim().max(100).parse(url.searchParams.get('search')??''),serving=z.enum(['all','pickup','delivery']).parse(url.searchParams.get('serving')??'all');
  const rows=(await pool.query<Branch>('SELECT * FROM bitpos.mobile_public_branches(NULL,$1,31,$2,$3)',[after,search,serving])).rows;
  return MobileBranchesSchema.parse({branches:rows.slice(0,30).map(r=>r.profile),nextCursor:rows.length>30?rows[29].profile.id:null});
 }
 const menu=/^\/api\/mobile\/v1\/branches\/([0-9a-f-]{36})\/menu$/.exec(path);
 if(menu&&method==='GET'){
  for(const key of url.searchParams.keys())if(!['cursor','menuVersion'].includes(key)||url.searchParams.getAll(key).length!==1)fail('INVALID_REQUEST',422);
  const after=url.searchParams.get('cursor'),version=url.searchParams.get('menuVersion');
  if((after===null)!==(version===null))fail('INVALID_REQUEST',422);if(after!==null)uuid.parse(after);if(version!==null)z.string().min(1).max(128).parse(version);
  const b=await publicBranch(uuid.parse(menu[1]));
  return tenant(b.merchant_id,async db=>{
   await enabledBranch(db,b.merchant_id,b.profile.id);const m=await effectiveCatalog(db,b.merchant_id);
   const heads=(await db.query<{product_id:string;active_version_id:string}>('SELECT product_id,active_version_id FROM product_online_options WHERE merchant_id=$1 ORDER BY product_id',[b.merchant_id])).rows;
   const menuVersion=hash(m.menuVersion+JSON.stringify(heads));if(version!==null&&version!==menuVersion)fail('QUOTE_CHANGED',409);
   const found=after===null?-1:m.products.findIndex(p=>p.id===after);if(after!==null&&found<0)fail('INVALID_REQUEST',422);
   const start=found+1,candidates=m.products.slice(start,start+30),pointers=new Map(heads.map(h=>[h.product_id,h.active_version_id]));
   const options=await productOptionsAt(db,b.merchant_id,candidates.map(p=>({productId:p.id,version:pointers.get(p.id)??null})));
   const metadata={branch:b.profile,asOf:m.asOf,priceValidUntil:m.priceValidUntil,menuVersion,priceVersion:m.priceVersion,pricingRevision:m.pricingRevision};
   const products:MobileProduct[]=[];let bytes=Buffer.byteLength(JSON.stringify({...metadata,products:[],nextCursor:'00000000-0000-4000-8000-000000000000'}));
   for(const p of candidates){
    const value=MobileProductSchema.parse({id:p.id,name:p.name,nameEn:p.nameEn,category:p.category??'',description:p.description??'',imageUrl:p.imageUrl??'',available:Math.max(0,p.available),unitPrice:p.unitPrice,basePrice:p.basePrice,options:options.get(p.id)!});
    const size=Buffer.byteLength(JSON.stringify(value))+(products.length?1:0);if(bytes+size>900*1024)break;
    bytes+=size;products.push(value);
   }
   if(candidates.length&&!products.length)throw Error('MENU_PRODUCT_EXCEEDS_PAGE_BUDGET');
   return MobileMenuSchema.parse({...metadata,products,nextCursor:start+products.length<m.products.length?products[products.length-1].id:null});
  });
 }
 const deliveryPolicy=/^\/api\/mobile\/v1\/branches\/([^/]+)\/delivery-policy$/.exec(path);
 if(deliveryPolicy&&method==='GET'){
  if(url.search)fail('INVALID_REQUEST',422);await mobilePrincipal(bearer);const id=uuid.parse(deliveryPolicy[1]),b=await publicBranch(id);
  return tenant(b.merchant_id,async db=>{
   const branch=await enabledBranch(db,b.merchant_id,id);if(!branch.delivery_enabled)fail('SERVING_UNAVAILABLE');
   const p=(await db.query(`SELECT p.* FROM branch_delivery_policies h JOIN delivery_policy_versions p ON(p.merchant_id,p.branch_id,p.id)=(h.merchant_id,h.branch_id,h.active_version_id) JOIN merchant_pricing m ON m.merchant_id=p.merchant_id AND m.active_price_version_id=p.price_version_id WHERE h.merchant_id=$1 AND h.branch_id=$2 AND h.enabled`,[b.merchant_id,id])).rows[0];
   if(!p)fail('SERVING_UNAVAILABLE');
   const money=(amount:string)=>({currency:p.currency,decimals:p.decimals,amountMinor:amount});
   return MobileCustomerDeliveryPolicySchema.parse({branchId:id,policyVersionId:p.id,priceVersionId:p.price_version_id,deliveryFee:money(p.delivery_minor),serviceFee:money(p.service_minor),originLatitudeE7:p.origin_latitude_e7,originLongitudeE7:p.origin_longitude_e7,southE7:p.south_e7,northE7:p.north_e7,westE7:p.west_e7,eastE7:p.east_e7,fixture:p.fixture});
  });
 }
 if(path==='/api/mobile/v1/food/quotes'&&method==='POST'){
  if(url.search)fail('INVALID_REQUEST',422);const actor=await mobilePrincipal(bearer),data=z.union([MobileFoodQuoteRequestSchema,MobileDeliveryQuoteRequestSchema]).parse(input),b=await publicBranch(data.branchId);
  return tenant(b.merchant_id,async db=>{
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[actor.accountId,actor.sessionId]);
   const delivery='delivery' in data?data.delivery:undefined;
   await routingLock(db,b.merchant_id);const branch=await enabledBranch(db,b.merchant_id,data.branchId);if(data.serving==='delivery'?!branch.delivery_enabled:!branch.pickup_enabled)fail('SERVING_UNAVAILABLE');
   const customer=await customerLink(db,b.merchant_id,actor.accountId);
   const q=await captureQuote(db,b.merchant_id,{kind:'online',id:actor.accountId,branchId:data.branchId},data.items,{kind:'versioned',source:{kind:'online',accountId:actor.accountId,branchId:data.branchId,channel:'customer_app',label:'BitPOS customer app'},serving:delivery?{kind:'delivery',label:'Delivery'}:{kind:'pickup',label:'Pickup'},target:null,pairingGeneration:null},customer,delivery);
   return quoteProjection(db,q,data.branchId);
  });
 }
 if(path==='/api/mobile/v1/food/orders'&&method==='POST'){
  if(url.search)fail('INVALID_REQUEST',422);const actor=await mobilePrincipal(bearer),data=MobileFoodOrderRequestSchema.parse(input);
  const location=(await pool.query<{merchant_id:string;branch_id:string}>('SELECT * FROM bitpos.mobile_owned_quote_location($1,$2,$3)',[actor.accountId,actor.sessionId,data.quoteId])).rows[0];
  if(!location||location.branch_id!==data.branchId)fail('RESOURCE_NOT_FOUND',404);
  return tenant(location.merchant_id,async db=>{
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[actor.accountId,actor.sessionId]);
   const merchant=location.merchant_id;await routingLock(db,merchant);
   const digest=hash(JSON.stringify({operation:'mobile.food.create',accountId:actor.accountId,branchId:data.branchId,quoteId:data.quoteId,priceVersion:data.priceVersion}));
   await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[merchant+'online'+actor.accountId+data.idempotencyKey]);
   const old=await submission(db,merchant,'online',actor.accountId,data.idempotencyKey);
   if(old){if(old.submission_hash!==digest)fail('IDEMPOTENCY_CONFLICT');return MobileFoodOrderResultSchema.parse({order:await mobileOrderProjection(db,old,actor.accountId),replayed:true});}
   const b=await enabledBranch(db,merchant,data.branchId);
   const q=(await db.query<QuoteRow>("SELECT * FROM order_quotes WHERE merchant_id=$1 AND id=$2 AND origin_kind='online' AND source_account_id=$3 AND source_branch_id=$4",[merchant,data.quoteId,actor.accountId,data.branchId])).rows[0];
   if(!q)fail('RESOURCE_NOT_FOUND',404);if(q.price_version_id!==data.priceVersion)fail('PRICE_VERSION_CHANGED');
   if(q.authority.serving.kind==='delivery'?!b.delivery_enabled:!b.pickup_enabled)fail('SERVING_UNAVAILABLE');
   await validateQuote(db,merchant,q);const customer=await customerLink(db,merchant,actor.accountId);
   const o=await createQuotedOrder(db,merchant,{quote:q,customerId:customer,idempotencyKey:data.idempotencyKey,requestHash:digest,screenGeneration:null});
   await emitOrder(db,o);return MobileFoodOrderResultSchema.parse({order:await mobileOrderProjection(db,o,actor.accountId),replayed:false});
  });
 }
 if(path==='/api/mobile/v1/food/orders'&&method==='GET'){
  const actor=await mobilePrincipal(bearer),locations=await ownedLocations(actor,null,cursor(url),31),orders:MobileFoodOrderSummary[]=[];
  for(const location of locations.slice(0,30))orders.push(await tenant(location.merchant_id,async db=>{
   const row=(await db.query(`SELECT o.id,o.merchant_id AS "merchantId",f.branch_id AS "branchId",m.name AS "merchantName",o.created_at,o.status,f.acceptance_status AS "acceptanceStatus",coalesce(k.status,'RECEIVED') AS "fulfillmentStatus",a.catalog_currency,a.catalog_decimals,a.total_minor::text
    FROM orders o JOIN online_food_orders f ON f.merchant_id=o.merchant_id AND f.order_id=o.id JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id JOIN merchants m ON m.id=o.merchant_id LEFT JOIN order_fulfillment k ON k.merchant_id=o.merchant_id AND k.order_id=o.id
    WHERE o.merchant_id=$1 AND o.id=$2 AND f.account_id=$3`,[location.merchant_id,location.order_id,actor.accountId])).rows[0];
   if(!row)fail('RESOURCE_NOT_FOUND',404);
   return MobileFoodOrderSummarySchema.parse({id:row.id,merchantId:row.merchantId,branchId:row.branchId,merchantName:row.merchantName,createdAt:new Date(row.created_at).toISOString(),status:row.status,acceptanceStatus:row.acceptanceStatus,fulfillmentStatus:row.fulfillmentStatus,total:{currency:row.catalog_currency,decimals:row.catalog_decimals,amountMinor:row.total_minor}});
  }));
  return MobileFoodOrdersSchema.parse({orders,nextCursor:locations.length>30?locations[29].order_id:null});
 }
 const refunds=/^\/api\/mobile\/v1\/food\/orders\/([0-9a-f-]{36})\/refunds$/.exec(path);
 if(refunds&&method==='GET'){
  for(const key of url.searchParams.keys())if(!['cursor','generation'].includes(key)||url.searchParams.getAll(key).length!==1)fail('INVALID_REQUEST',422);
  const rawCursor=url.searchParams.get('cursor'),after=rawCursor===null?null:uuid.parse(rawCursor),generation=url.searchParams.get('generation');
  if((after===null)!==(generation===null))fail('INVALID_REQUEST',422);if(generation!==null)integer.parse(generation);
  const actor=await mobilePrincipal(bearer),id=uuid.parse(refunds[1]),location=(await ownedLocations(actor,id,null,1))[0];if(!location)fail('RESOURCE_NOT_FOUND',404);
  return tenant(location.merchant_id,async db=>{
   // Recheck account inside the tenant transaction; never use cursor identity as authority.
   await db.query('SELECT id FROM orders WHERE merchant_id=$1 AND id=$2 FOR SHARE',[location.merchant_id,id]);
   const owned=(await db.query<{event_sequence:string}>('SELECT event_sequence::text FROM online_food_orders WHERE merchant_id=$1 AND order_id=$2 AND account_id=$3',[location.merchant_id,id,actor.accountId])).rows[0];if(!owned)fail('RESOURCE_NOT_FOUND',404);
   if(generation!==null&&generation!==owned.event_sequence)fail('REFUND_PAGE_CHANGED',409);
   if(after!==null&&!(await db.query('SELECT 1 FROM refunds WHERE merchant_id=$1 AND order_id=$2 AND id=$3',[location.merchant_id,id,after])).rowCount)fail('RESOURCE_NOT_FOUND',404);
   const rows=(await db.query(`SELECT r.id,r.version::text,jsonb_build_object('currency',r.settlement->>'currency','decimals',(r.settlement->>'decimals')::integer,'amountMinor',r.amount_minor::text) AS money,r.status,r.cause
    FROM refunds r WHERE r.merchant_id=$1 AND r.order_id=$2 AND ($3::uuid IS NULL OR (r.created_at,r.id)>(SELECT c.created_at,c.id FROM refunds c WHERE c.merchant_id=$1 AND c.order_id=$2 AND c.id=$3)) ORDER BY r.created_at,r.id LIMIT 31`,[location.merchant_id,id,after])).rows;
   return MobileFoodRefundsSchema.parse({refunds:rows.slice(0,30),nextCursor:rows.length>30?rows[29].id:null,generation:owned.event_sequence});
  });
 }
 const order=/^\/api\/mobile\/v1\/food\/orders\/([0-9a-f-]{36})$/.exec(path);
 if(order&&method==='GET'){
  if(url.search)fail('INVALID_REQUEST',422);const actor=await mobilePrincipal(bearer),id=uuid.parse(order[1]),location=(await ownedLocations(actor,id,null,1))[0];if(!location)fail('RESOURCE_NOT_FOUND',404);
  return tenant(location.merchant_id,async db=>{const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR SHARE',[location.merchant_id,id])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);return mobileOrderProjection(db,o,actor.accountId);});
 }
 const events=/^\/api\/mobile\/v1\/food\/orders\/([0-9a-f-]{36})\/events$/.exec(path);
 if(events&&method==='GET'){
  for(const key of url.searchParams.keys())if(key!=='cursor')fail('INVALID_REQUEST',422);
  if(url.searchParams.getAll('cursor').length>1)fail('INVALID_REQUEST',422);
  const after=integer.parse(url.searchParams.get('cursor')??'0'),actor=await mobilePrincipal(bearer),id=uuid.parse(events[1]);
  const location=(await ownedLocations(actor,id,null,1))[0];if(!location)fail('RESOURCE_NOT_FOUND',404);
  return tenant(location.merchant_id,async db=>{
   const o=(await db.query<OrderRow>('SELECT * FROM orders WHERE merchant_id=$1 AND id=$2 FOR SHARE',[location.merchant_id,id])).rows[0];if(!o)fail('RESOURCE_NOT_FOUND',404);
   const snapshot=await mobileOrderProjection(db,o,actor.accountId);
   const rows=(await db.query('SELECT id,sequence::text,kind,occurred_at,facts FROM mobile_order_events WHERE merchant_id=$1 AND order_id=$2 AND sequence>$3 ORDER BY sequence LIMIT 101',[location.merchant_id,id,after])).rows;
   return MobileFoodEventsSchema.parse({order:snapshot,events:rows.slice(0,100).map(e=>({id:e.id,sequence:e.sequence,kind:e.kind,occurredAt:new Date(e.occurred_at).toISOString(),...e.facts})),nextCursor:rows.length>100?rows[99].sequence:null});
  });
 }
 return undefined;
}
