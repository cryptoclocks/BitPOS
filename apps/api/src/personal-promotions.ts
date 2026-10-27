import type pg from 'pg';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {EffectiveLine,Money} from '../../../packages/contracts/src/index';
import {personalTargetInput,personalRecipientsView as recipientsSchema,type PromotionRecipientsView,type PersonalTargetInput,type PersonalCampaignBinding,type PersonalPromotionLine,type VisitRecipientProof,type PersonalPromotionContextResult} from '../../../packages/contracts/src/personal-promotions';
import {hash} from '../../../packages/domain/src/index';
import {promotionPrice} from '../../../packages/domain/src/promotions';
import type {EffectiveMenu} from './offers';
import type {QuoteRow} from './types';
import {authenticateCustomerSession} from './customer-auth';
import {fail,routingLock} from './authority';
const proofSchema=z.object({sourceVisitToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),customerSessionToken:z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional()}).strict();
/** Advisory POST can remember immutable private proof, but cannot create an occupancy or recipient. */
export async function rememberVisitRecipientProof(db:pg.PoolClient,merchant:string,visitId:string,proof:VisitRecipientProof):Promise<void>{
 const p=proofSchema.parse(proof);await routingLock(db,merchant);
 const identity=p.customerSessionToken?await authenticateCustomerSession(db,merchant,p.customerSessionToken):null;
 const sourceHash=p.sourceVisitToken?createHash('sha256').update(p.sourceVisitToken).digest('hex'):null;
 const previous=(await db.query('SELECT source_visit_hash,customer_auth_session_id FROM table_visit_recipient_proofs WHERE merchant_id=$1 AND visit_id=$2',[merchant,visitId])).rows[0];
 if(previous){if(previous.source_visit_hash!==sourceHash||previous.customer_auth_session_id!==(identity?.sessionId??null))fail('IDEMPOTENCY_CONFLICT');return;}
 // No proof is not an identity: do not reserve an empty sidecar before a visitor explicitly opts in.
 if(!p.sourceVisitToken&&!p.customerSessionToken)return;
 await db.query('INSERT INTO table_visit_recipient_proofs(merchant_id,visit_id,source_visit_hash,customer_auth_session_id) VALUES($1,$2,$3,$4)',[merchant,visitId,sourceHash,identity?.sessionId??null]);
}
/** Call only after capture_quote_occupancy has acquired actual membership, in the same tenant transaction. */
export async function bindVisitRecipient(db:pg.PoolClient,merchant:string,visitId:string,proof:VisitRecipientProof={}):Promise<void>{
 await routingLock(db,merchant);
 if(proof.sourceVisitToken||proof.customerSessionToken)await rememberVisitRecipientProof(db,merchant,visitId,proof);
 if(!(await db.query('SELECT bind_visit_recipient($1,$2) AS bound',[merchant,visitId])).rows[0]?.bound)fail('TABLE_OCCUPANCY_CHANGED');
}
/** Verified identity belongs only to the original immutable visit recipient, never the order's guest customer field. */
export async function bindOrderCustomer(db:pg.PoolClient,merchant:string,orderId:string,customerSessionToken:string):Promise<void>{
 await routingLock(db,merchant);const identity=await authenticateCustomerSession(db,merchant,customerSessionToken);
 if(!(await db.query('SELECT bind_order_recipient_customer($1,$2,$3) AS bound',[merchant,orderId,identity.sessionId])).rows[0]?.bound)fail('WALLET_CONFLICT');
}
interface TargetRow {occupancy_id:string;generation:string;recipient_id:string;target_device_id:string;assignment_generation:string;auth_generation:string;customer_id:string|null;customer_auth_session_id:string|null;}
export async function personalPromotionContext(db:pg.PoolClient,merchant:string,audience:'customer'|'from_order',input:PersonalTargetInput):Promise<PersonalPromotionContextResult>{
 const d=personalTargetInput.parse(input);await routingLock(db,merchant);
 if(audience==='customer'&&!d.customerId||audience==='from_order'&&!d.sourceOrderId||audience==='customer'&&d.sourceOrderId)fail('INVALID_REQUEST',422);
 const target=(await db.query<TargetRow>(`SELECT o.id AS occupancy_id,o.generation::text,r.recipient_id,e.device_id AS target_device_id,e.assignment_generation::text,e.auth_generation::text,
 p.customer_id,valid_auth.id AS customer_auth_session_id
 FROM table_visit_recipients r JOIN table_occupancies o ON o.merchant_id=r.merchant_id AND o.id=r.occupancy_id
 JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id
 JOIN table_visits v ON v.merchant_id=r.merchant_id AND v.id=r.visit_id JOIN table_entries e ON e.merchant_id=v.merchant_id AND e.id=v.entry_id
 JOIN devices device ON device.merchant_id=e.merchant_id AND device.id=e.device_id
 LEFT JOIN table_recipient_profiles p ON p.merchant_id=r.merchant_id AND p.recipient_id=r.recipient_id
 LEFT JOIN LATERAL (SELECT a.id FROM table_recipient_auth_sessions link JOIN customer_auth_sessions a ON a.merchant_id=link.merchant_id AND a.id=link.customer_auth_session_id
 WHERE link.merchant_id=r.merchant_id AND link.recipient_id=r.recipient_id AND a.customer_id=p.customer_id AND customer_personal_auth_current(a.merchant_id,a.id) ORDER BY a.consented_at DESC LIMIT 1) valid_auth ON true
 WHERE r.merchant_id=$1 AND r.visit_id=$2 AND o.table_id=$3 AND o.generation=$4 AND o.closed_at IS NULL
 AND t.occupancy_generation=o.generation AND t.retired_at IS NULL AND e.table_id=o.table_id AND device.table_id=o.table_id AND device.revoked_at IS NULL
 AND device.assignment_generation=e.assignment_generation AND device.auth_generation=e.auth_generation`,[merchant,d.recipientVisitId,d.tableId,d.occupancyGeneration])).rows[0];
 if(!target)fail('TABLE_OCCUPANCY_CHANGED');
 let customerId=target.customer_id,originBasis:PersonalCampaignBinding['originBasis']='private_paid_visit';
 if(audience==='customer'){
  if(!(await db.query('SELECT 1 FROM customers WHERE merchant_id=$1 AND id=$2',[merchant,d.customerId])).rowCount)fail('RESOURCE_NOT_FOUND',404);
  if(customerId&&customerId!==d.customerId)fail('WALLET_CONFLICT');
  if(!customerId)await db.query("INSERT INTO table_recipient_profiles(merchant_id,recipient_id,customer_id,basis) VALUES($1,$2,$3,'staff_recognition')",[merchant,target.recipient_id,d.customerId]);
  customerId=d.customerId!;originBasis='staff_recognition';
 }
 const currentOrderItems:{productId:string;quantity:number}[]=[];
 if(d.sourceOrderId){
  if(!(await db.query(`SELECT 1 FROM orders original JOIN order_authority a ON a.merchant_id=original.merchant_id AND a.order_id=original.id
   JOIN order_table_occupancies group_link ON group_link.merchant_id=a.merchant_id AND group_link.order_id=a.order_id
   JOIN quote_table_occupancies quote ON quote.merchant_id=group_link.merchant_id AND quote.quote_id=group_link.quote_id
   JOIN order_quotes q ON q.merchant_id=quote.merchant_id AND q.id=quote.quote_id JOIN device_sessions s ON s.merchant_id=q.merchant_id AND s.id=q.session_id
   JOIN table_visit_recipients recipient ON recipient.merchant_id=s.merchant_id AND recipient.visit_id=s.public_visit_id
   WHERE original.merchant_id=$1 AND original.id=$2 AND personal_order_verified_paid(original.merchant_id,original.id)
   AND group_link.occupancy_id=$3 AND recipient.occupancy_id=$3 AND recipient.recipient_id=$4
   AND a.serving_table_id=$5 AND a.target_device_id=$6 AND a.target_assignment_generation=$7
   AND quote.target_device_id=$6 AND quote.assignment_generation=$7 AND quote.auth_generation=$8 AND quote.generation=$9`,[merchant,d.sourceOrderId,target.occupancy_id,target.recipient_id,d.tableId,target.target_device_id,target.assignment_generation,target.auth_generation,d.occupancyGeneration])).rowCount)fail('PROMOTION_OFFER_INVALID');
  if(d.customerId&&d.customerId!==customerId)fail('WALLET_CONFLICT');
  currentOrderItems.push(...(await db.query<{productId:string;quantity:number}>('SELECT product_id AS "productId",qty AS quantity FROM order_items WHERE merchant_id=$1 AND order_id=$2 ORDER BY product_id',[merchant,d.sourceOrderId])).rows);
  if(target.customer_auth_session_id)originBasis='verified_wallet_consent';
 }
 const historyIncluded=audience==='customer'||!!target.customer_auth_session_id;
 if(target.customer_auth_session_id){
  await db.query('SELECT id FROM customer_auth_sessions WHERE merchant_id=$1 AND id=$2 FOR SHARE',[merchant,target.customer_auth_session_id]);
  if(!(await db.query('SELECT customer_personal_auth_current($1,$2) AS current',[merchant,target.customer_auth_session_id])).rows[0]?.current)fail('AUTH_REQUIRED',401);
 }
 const items=historyIncluded&&customerId?(await db.query<{productId:string;quantity:number;lastPurchasedDaysAgo:number}>(`SELECT i.product_id AS "productId",sum(i.qty)::integer AS quantity,
 floor(extract(epoch FROM clock_timestamp()-max(o.paid_at))/86400)::integer AS "lastPurchasedDaysAgo"
 FROM orders o JOIN order_items i ON i.merchant_id=o.merchant_id AND i.order_id=o.id
 WHERE o.merchant_id=$1 AND personal_order_verified_paid(o.merchant_id,o.id) AND o.paid_at>=clock_timestamp()-interval '52 weeks'
 AND (EXISTS(SELECT 1 FROM order_customer_profiles p WHERE p.merchant_id=o.merchant_id AND p.order_id=o.id AND p.customer_id=$2)
 OR $3::boolean AND (o.customer_id=$2 OR EXISTS(SELECT 1 FROM customer_wallets w JOIN payment_attempts paid ON paid.merchant_id=w.merchant_id AND paid.payer=w.address
 JOIN payments receipt ON receipt.merchant_id=paid.merchant_id AND receipt.attempt_id=paid.id AND receipt.order_id=paid.order_id
 WHERE w.merchant_id=o.merchant_id AND w.customer_id=$2 AND w.chain='solana:devnet' AND paid.order_id=o.id AND paid.status='FINALIZED' AND receipt.state='SETTLED')))
 GROUP BY i.product_id ORDER BY sum(i.qty) DESC,max(o.paid_at) DESC,i.product_id LIMIT 20`,[merchant,customerId,audience==='customer'])).rows:[];
 const excludedProductIds=currentOrderItems.map(i=>i.productId);
 return {context:{kind:audience,items,currentOrderItems,historyIncluded,historyBasis:audience==='customer'?'staff_confirmed_profile':historyIncluded?'verified_wallet_consent':'current_order_only'},excludedProductIds,binding:{tableId:d.tableId,occupancyId:target.occupancy_id,occupancyGeneration:d.occupancyGeneration,recipientId:target.recipient_id,recipientVisitId:d.recipientVisitId,targetDeviceId:target.target_device_id,assignmentGeneration:target.assignment_generation,authGeneration:target.auth_generation,customerId,customerAuthSessionId:audience==='from_order'?target.customer_auth_session_id:null,sourceOrderId:d.sourceOrderId??null,originBasis,excludedProductIds}};
}
export async function savePersonalJobBinding(db:pg.PoolClient,merchant:string,jobId:string,binding:PersonalCampaignBinding):Promise<void>{
 await routingLock(db,merchant);
 await db.query(`INSERT INTO personal_promotion_job_bindings(merchant_id,job_id,table_id,occupancy_id,occupancy_generation,recipient_id,recipient_visit_id,target_device_id,assignment_generation,auth_generation,customer_id,customer_auth_session_id,source_order_id,origin_basis,excluded_product_ids)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[merchant,jobId,binding.tableId,binding.occupancyId,binding.occupancyGeneration,binding.recipientId,binding.recipientVisitId,binding.targetDeviceId,binding.assignmentGeneration,binding.authGeneration,binding.customerId,binding.customerAuthSessionId,binding.sourceOrderId,binding.originBasis,binding.excludedProductIds]);
}
export async function personalCampaignBinding(db:pg.PoolClient,merchant:string,jobId:string):Promise<PersonalCampaignBinding|null>{
 const row=(await db.query<PersonalCampaignBinding>(`SELECT table_id AS "tableId",occupancy_id AS "occupancyId",occupancy_generation::text AS "occupancyGeneration",
 recipient_id AS "recipientId",recipient_visit_id AS "recipientVisitId",target_device_id AS "targetDeviceId",assignment_generation::text AS "assignmentGeneration",auth_generation::text AS "authGeneration",
 customer_id AS "customerId",customer_auth_session_id AS "customerAuthSessionId",source_order_id AS "sourceOrderId",origin_basis AS "originBasis",excluded_product_ids AS "excludedProductIds"
 FROM personal_promotion_job_bindings WHERE merchant_id=$1 AND job_id=$2`,[merchant,jobId])).rows[0];
 return row??null;
}
/** Bounded staff-only discovery, no contacts/wallets or public recipient capability. */
export async function personalRecipientsView(db:pg.PoolClient,merchant:string):Promise<PromotionRecipientsView>{
 const tables=(await db.query(`SELECT t.id,t.label,t.occupancy_generation::text AS generation,o.id IS NOT NULL AS active,
 (SELECT CASE WHEN count(*)=1 THEN (jsonb_agg(jsonb_build_object('id',d.id,'assignmentGeneration',d.assignment_generation::text,'authGeneration',d.auth_generation::text))->0) ELSE NULL END FROM devices d
 WHERE d.merchant_id=t.merchant_id AND d.table_id=t.id AND d.revoked_at IS NULL
 AND EXISTS(SELECT 1 FROM table_entries e WHERE e.merchant_id=d.merchant_id AND e.device_id=d.id AND e.table_id=t.id AND e.assignment_generation=d.assignment_generation AND e.auth_generation=d.auth_generation)
 ) AS device,
 coalesce((SELECT jsonb_agg(guest ORDER BY guest->>'visitId') FROM (
 SELECT jsonb_build_object('visitId',r.visit_id,'recipientId',r.recipient_id,'customerId',p.customer_id,
 'recognition',CASE WHEN EXISTS(SELECT 1 FROM table_recipient_auth_sessions link WHERE link.merchant_id=r.merchant_id AND link.recipient_id=r.recipient_id AND customer_personal_auth_current(link.merchant_id,link.customer_auth_session_id)) THEN 'verified_wallet' WHEN p.basis='staff_recognition' THEN 'staff_confirmed_profile' ELSE 'guest' END,
 'orderId',v.order_id,'deviceId',e.device_id) AS guest FROM table_visit_recipients r
 JOIN table_visits v ON v.merchant_id=r.merchant_id AND v.id=r.visit_id JOIN table_entries e ON e.merchant_id=v.merchant_id AND e.id=v.entry_id
 LEFT JOIN table_recipient_profiles p ON p.merchant_id=r.merchant_id AND p.recipient_id=r.recipient_id
 WHERE r.merchant_id=t.merchant_id AND r.occupancy_id=o.id ORDER BY v.created_at DESC,r.visit_id LIMIT 200) guests),'[]'::jsonb) AS guests
 FROM merchant_tables t LEFT JOIN table_occupancies o ON o.merchant_id=t.merchant_id AND o.table_id=t.id AND o.closed_at IS NULL AND o.generation=t.occupancy_generation
 WHERE t.merchant_id=$1 AND t.retired_at IS NULL ORDER BY t.label,t.id LIMIT 200`,[merchant])).rows;
 const customers=(await db.query(`SELECT c.id,c.name,c.avatar,
 (SELECT w.address FROM customer_wallets w WHERE w.merchant_id=c.merchant_id AND w.customer_id=c.id AND w.chain='solana:devnet' ORDER BY w.address LIMIT 1) AS avatar_source,
 (SELECT left(w.address,4)||'…'||right(w.address,4) FROM customer_wallets w WHERE w.merchant_id=c.merchant_id AND w.customer_id=c.id AND w.chain='solana:devnet' ORDER BY w.address LIMIT 1) AS "walletLabel",
 (SELECT count(DISTINCT o.id)::integer FROM orders o WHERE o.merchant_id=c.merchant_id AND personal_order_verified_paid(o.merchant_id,o.id) AND
 (o.customer_id=c.id OR EXISTS(SELECT 1 FROM customer_wallets w JOIN payment_attempts a ON a.merchant_id=w.merchant_id AND a.payer=w.address
 JOIN payments receipt ON receipt.merchant_id=a.merchant_id AND receipt.order_id=a.order_id AND receipt.attempt_id=a.id
 WHERE w.merchant_id=c.merchant_id AND w.customer_id=c.id AND w.chain='solana:devnet' AND a.order_id=o.id AND a.status='FINALIZED' AND receipt.state='SETTLED'))) AS "paidOrders"
 FROM customers c WHERE c.merchant_id=$1 AND (btrim(c.name)<>'' OR EXISTS(SELECT 1 FROM customer_wallets w WHERE w.merchant_id=c.merchant_id AND w.customer_id=c.id)
 OR EXISTS(SELECT 1 FROM table_recipient_profiles p WHERE p.merchant_id=c.merchant_id AND p.customer_id=c.id))
 ORDER BY "paidOrders" DESC,c.name,c.id LIMIT 1000`,[merchant])).rows.map(({avatar_source,...customer})=>({...customer,avatarSeed:hash('solana:devnet:'+(avatar_source??customer.id)).slice(0,12)}));
 const orders=(await db.query(`SELECT original.id,a.serving_table_id AS "tableId",quote.generation::text AS "occupancyGeneration",r.visit_id AS "recipientVisitId",a.target_device_id AS "targetDeviceId",
 (SELECT jsonb_agg(jsonb_build_object('productId',i.product_id,'quantity',i.qty) ORDER BY i.product_id) FROM order_items i WHERE i.merchant_id=original.merchant_id AND i.order_id=original.id) AS items
 FROM orders original JOIN order_authority a ON a.merchant_id=original.merchant_id AND a.order_id=original.id
 JOIN order_table_occupancies member ON member.merchant_id=a.merchant_id AND member.order_id=a.order_id
 JOIN quote_table_occupancies quote ON quote.merchant_id=member.merchant_id AND quote.quote_id=member.quote_id
 JOIN table_occupancies o ON o.merchant_id=member.merchant_id AND o.id=member.occupancy_id
 JOIN merchant_tables t ON t.merchant_id=o.merchant_id AND t.id=o.table_id JOIN devices d ON d.merchant_id=a.merchant_id AND d.id=a.target_device_id
 JOIN order_quotes q ON q.merchant_id=a.merchant_id AND q.id=a.quote_id JOIN device_sessions s ON s.merchant_id=q.merchant_id AND s.id=q.session_id
 JOIN table_visit_recipients r ON r.merchant_id=s.merchant_id AND r.visit_id=s.public_visit_id AND r.occupancy_id=o.id
 WHERE original.merchant_id=$1 AND personal_order_verified_paid(original.merchant_id,original.id) AND o.closed_at IS NULL AND o.generation=t.occupancy_generation AND t.retired_at IS NULL
 AND d.revoked_at IS NULL AND d.table_id=t.id AND d.assignment_generation=quote.assignment_generation AND d.auth_generation=quote.auth_generation
 ORDER BY original.paid_at DESC,original.id LIMIT 100`,[merchant])).rows;
 return recipientsSchema.parse({tables,customers,orders});
}
/** Call before provider reservation/send, after provider completion, and immediately before publish. No budget refund or retry. */
export async function guardPersonalJob(db:pg.PoolClient,merchant:string,jobId:string):Promise<void>{
 await routingLock(db,merchant);
 const binding=(await db.query('SELECT customer_auth_session_id FROM personal_promotion_job_bindings WHERE merchant_id=$1 AND job_id=$2',[merchant,jobId])).rows[0];
 if(!binding){
  if((await db.query("SELECT 1 FROM promotion_job_contexts WHERE merchant_id=$1 AND job_id=$2 AND audience IN ('customer','from_order')",[merchant,jobId])).rowCount)fail('PROMOTION_TARGET_CHANGED');
  return;
 }
 if(binding.customer_auth_session_id)await db.query('SELECT id FROM customer_auth_sessions WHERE merchant_id=$1 AND id=$2 FOR SHARE',[merchant,binding.customer_auth_session_id]);
 if(!(await db.query('SELECT personal_job_binding_current($1,$2) AS current',[merchant,jobId])).rows[0]?.current)fail('PROMOTION_TARGET_CHANGED');
}
export async function cancelPersonalTable(db:pg.PoolClient,merchant:string,table:string,generation:string):Promise<void>{
 await routingLock(db,merchant);
 await db.query(`UPDATE ai_generation_jobs j SET state='FAILED',blocker=CASE WHEN j.state='RUNNING' THEN 'TABLE_CLEARED_PROVIDER_OUTCOME_UNKNOWN' ELSE 'TABLE_CLEARED' END,lease_id=NULL,lease_until=NULL,finished_at=clock_timestamp()
 FROM personal_promotion_job_bindings b WHERE b.merchant_id=$1 AND b.table_id=$2 AND b.occupancy_generation=$3 AND j.merchant_id=b.merchant_id AND j.id=b.job_id AND j.state IN ('QUEUED','RUNNING')`,[merchant,table,generation]);
 await db.query("UPDATE promotion_playlist_targets SET state='REVOKED',failure='TABLE_CLEARED' WHERE merchant_id=$1 AND table_id=$2 AND occupancy_generation=$3 AND audience='personal' AND state NOT IN ('EXPIRED','REVOKED','TARGET_CHANGED')",[merchant,table,generation]);
 await db.query("UPDATE promotion_campaigns c SET state='REVOKED',version=version+1 FROM personal_promotion_job_bindings b WHERE b.merchant_id=$1 AND b.table_id=$2 AND b.occupancy_generation=$3 AND c.merchant_id=b.merchant_id AND c.job_id=b.job_id AND c.state IN ('DRAFT','APPROVED')",[merchant,table,generation]);
}
interface PersonalMenuRow {id:string;campaign_id:string;campaign_version:number;recipient_id:string;occupancy_id:string;occupancy_generation:string;expires_at:Date;product_id:string;minimum_unit_minor:string;content:{discountPercent:number;snapshot:{priceVersion:string;basePrice:Money;imageUrl:unknown}};}
export async function personalPromotionMenu(db:pg.PoolClient,merchant:string,menu:EffectiveMenu,sessionId:string|null):Promise<EffectiveMenu>{
 if(!sessionId)return menu;
 const rows=(await db.query<PersonalMenuRow>(`SELECT target.id,target.campaign_id,target.campaign_version,target.recipient_id,target.occupancy_id,target.occupancy_generation::text,
 target.expires_at,c.product_id,scope.minimum_unit_minor::text,revision.content FROM promotion_playlist_targets target
 JOIN promotion_campaigns c ON c.merchant_id=target.merchant_id AND c.id=target.campaign_id
 JOIN promotion_scopes scope ON scope.merchant_id=c.merchant_id AND scope.campaign_id=c.id AND scope.audience IN ('customer','from_order')
 JOIN promotion_revisions revision ON revision.merchant_id=target.merchant_id AND revision.campaign_id=target.campaign_id AND revision.version=target.campaign_version
 WHERE target.merchant_id=$1 AND target.audience='personal' AND personal_promotion_eligible($1,target.id,$2) ORDER BY target.campaign_version DESC,target.id`,[merchant,sessionId])).rows;
 const selected=new Map<string,{unitPrice:Money;personalPromotion:PersonalPromotionLine}>();
 for(const row of rows){
  const product=menu.products.find(p=>p.id===row.product_id),snapshot=row.content.snapshot;
  if(!product?.basePrice||!product.unitPrice||product.available<1||menu.priceVersion!==snapshot.priceVersion||product.basePrice.amountMinor!==snapshot.basePrice.amountMinor||product.imageUrl!==snapshot.imageUrl)continue;
  let unitPrice:Money;try{unitPrice=promotionPrice(product.basePrice,product.unitPrice,row.content.discountPercent,row.content.discountPercent);}catch{continue;}
  if(BigInt(unitPrice.amountMinor)<BigInt(row.minimum_unit_minor))continue;
  const prior=selected.get(product.id);if(prior&&BigInt(prior.unitPrice.amountMinor)<=BigInt(unitPrice.amountMinor))continue;
  selected.set(product.id,{unitPrice,personalPromotion:{targetId:row.id,campaignId:row.campaign_id,campaignVersion:row.campaign_version,recipientId:row.recipient_id,occupancyId:row.occupancy_id,occupancyGeneration:row.occupancy_generation,sessionId,discountPercent:row.content.discountPercent,expiresAt:new Date(row.expires_at).toISOString()}});
 }
 if(!selected.size)return menu;
 const expiry=Math.min(Date.parse(menu.priceValidUntil),...Array.from(selected.values(),v=>Date.parse(v.personalPromotion.expiresAt)));
 return {...menu,priceValidUntil:new Date(expiry).toISOString(),menuVersion:hash(menu.menuVersion+JSON.stringify(Array.from(selected))),products:menu.products.map(p=>{const personal=selected.get(p.id);if(!personal)return p;const {dailyPromotion:daily,scopedPromotion:scoped,...rest}=p;return {...rest,...personal,promotion:null};})};
}
export async function validatePersonalQuote(db:pg.PoolClient,merchant:string,q:QuoteRow):Promise<void>{
 await routingLock(db,merchant);
 for(const line of q.lines){const p=line.personalPromotion;if(!p)continue;
  await db.query(`SELECT a.id FROM promotion_playlist_targets target JOIN promotion_campaigns c ON c.merchant_id=target.merchant_id AND c.id=target.campaign_id
  JOIN personal_promotion_job_bindings b ON b.merchant_id=c.merchant_id AND b.job_id=c.job_id JOIN customer_auth_sessions a ON a.merchant_id=b.merchant_id AND a.id=b.customer_auth_session_id
  WHERE target.merchant_id=$1 AND target.id=$2 FOR SHARE OF a`,[merchant,p.targetId]);
  if(line.qty!==1||line.promotion||line.dailyPromotion||line.scopedPromotion||q.session_id!==p.sessionId||!(await db.query('SELECT personal_promotion_eligible($1,$2,$3) AS eligible',[merchant,p.targetId,q.session_id])).rows[0]?.eligible)fail('PROMOTION_OFFER_INVALID');
 }
}
export async function freezePersonalQuote(db:pg.PoolClient,merchant:string,quoteId:string,lines:EffectiveLine[]):Promise<void>{
 for(const line of lines){const p=line.personalPromotion;if(p)await db.query('INSERT INTO personal_quote_promotions(merchant_id,quote_id,product_id,target_id,campaign_id,campaign_version,recipient_id,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[merchant,quoteId,line.productId,p.targetId,p.campaignId,p.campaignVersion,p.recipientId,p]);}
}
export async function freezePersonalOrder(db:pg.PoolClient,merchant:string,orderId:string,q:QuoteRow):Promise<void>{
 for(const line of q.lines){const p=line.personalPromotion;if(p)await db.query('INSERT INTO personal_order_promotions(merchant_id,order_id,product_id,quote_id,target_id,campaign_id,campaign_version,recipient_id,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[merchant,orderId,line.productId,q.id,p.targetId,p.campaignId,p.campaignVersion,p.recipientId,p]);}
}
