import type pg from 'pg';
import type {EffectiveLine,ScopedPromotionLine} from '../../../packages/contracts/src/index';
import type {QuoteRow} from './types';
import {promotionPrice} from '../../../packages/domain/src/promotions';
import {fail} from './authority';
import type {EffectiveMenu} from './offers';
import {hash} from '../../../packages/domain/src/index';
export async function claimPromotionOffer(db:pg.PoolClient,merchant:string,token:string,sessionId:string,visitId:string|null){
 const t=(await db.query(`SELECT t.*,e.session_id AS bound_session FROM promotion_targets t LEFT JOIN scoped_offer_eligibility e ON e.merchant_id=t.merchant_id AND e.target_id=t.id WHERE t.merchant_id=$1 AND t.offer_token=$2 FOR UPDATE OF t`,[merchant,token])).rows[0];
 if(!t||t.bound_session&&t.bound_session!==sessionId)fail('PROMOTION_OFFER_INVALID');
 if(t.bound_session===sessionId){if(!(await db.query('SELECT bitpos.promotion_eligible($1::uuid,$2::uuid,$3::uuid) AS eligible',[merchant,t.id,sessionId])).rows[0].eligible)fail('PROMOTION_OFFER_INVALID');return;}
 const valid=(await db.query(`SELECT 1 FROM promotion_targets t JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id JOIN device_sessions s ON s.merchant_id=t.merchant_id AND s.id=$3 JOIN devices d ON d.merchant_id=s.merchant_id AND d.id=s.device_id JOIN device_screen_state screen ON screen.merchant_id=s.merchant_id AND screen.device_id=s.device_id WHERE t.merchant_id=$1 AND t.id=$2 AND t.state IN ('DELIVERED','RENDERED') AND c.state='APPROVED' AND c.approved_version=t.campaign_version AND c.starts_at<=clock_timestamp() AND t.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp() AND bitpos.promotion_binding_current(t.merchant_id,t.id) AND s.device_id=t.target_device_id AND s.assignment_generation=t.assignment_generation AND s.ended_at IS NULL AND s.public_visit_id IS NOT DISTINCT FROM $4::uuid AND screen.kind='cart' AND screen.session_id=s.id AND screen.lease_until>clock_timestamp() AND (($4::uuid IS NULL AND d.pickup_guest_generation=t.guest_generation) OR ($4::uuid IS NOT NULL AND s.pickup_guest_generation=t.guest_generation+1 AND d.pickup_guest_generation=s.pickup_guest_generation))`,[merchant,t.id,sessionId,visitId])).rowCount;
 if(!valid)fail('PROMOTION_OFFER_INVALID');
 if((await db.query('SELECT s.screen_generation=t.screen_generation+1 AS original_acquisition FROM promotion_targets t JOIN device_screen_state s ON s.merchant_id=t.merchant_id AND s.device_id=t.target_device_id WHERE t.merchant_id=$1 AND t.id=$2',[merchant,t.id])).rows[0]?.original_acquisition!==true)fail('PROMOTION_OFFER_INVALID');
 await db.query('INSERT INTO scoped_offer_eligibility(merchant_id,target_id,session_id,visit_id) VALUES($1,$2,$3,$4)',[merchant,t.id,sessionId,visitId]);
}
export async function scopePromotionMenu(db:pg.PoolClient,merchant:string,menu:EffectiveMenu,sessionId:string|null):Promise<EffectiveMenu>{
 if(!sessionId)return menu;
 const row=(await db.query(`SELECT t.id AS target_id,t.campaign_id,t.campaign_version,t.expires_at,c.product_id,c.discount_percent,c.max_discount_percent,c.snapshot FROM scoped_offer_eligibility e JOIN promotion_targets t ON t.merchant_id=e.merchant_id AND t.id=e.target_id JOIN promotion_campaigns c ON c.merchant_id=t.merchant_id AND c.id=t.campaign_id WHERE e.merchant_id=$1 AND e.session_id=$2 AND bitpos.promotion_eligible(e.merchant_id,e.target_id,e.session_id)`,[merchant,sessionId])).rows[0];if(!row)return menu;
 const p=menu.products.find(p=>p.id===row.product_id);if(!p?.basePrice||!p.unitPrice||p.available<1||menu.priceVersion!==row.snapshot.priceVersion||p.basePrice.amountMinor!==row.snapshot.basePrice.amountMinor||p.unitPrice.amountMinor!==row.snapshot.effectivePrice.amountMinor)fail('PROMOTION_REVIEW_REQUIRED');
 let unitPrice;try{unitPrice=promotionPrice(p.basePrice,p.unitPrice,row.discount_percent,row.max_discount_percent);}catch{fail('PROMOTION_REVIEW_REQUIRED');}
 const scopedPromotion:ScopedPromotionLine={targetId:row.target_id,campaignId:row.campaign_id,campaignVersion:row.campaign_version,sessionId,discountPercent:row.discount_percent,expiresAt:new Date(row.expires_at).toISOString()};
 return {...menu,priceValidUntil:new Date(Math.min(Date.parse(menu.priceValidUntil),new Date(row.expires_at).getTime())).toISOString(),menuVersion:hash(menu.menuVersion+':'+row.target_id),products:menu.products.map(product=>product.id===p.id?{...product,unitPrice,promotion:null,scopedPromotion}:product)};
}
export async function validateScopedQuote(db:pg.PoolClient,merchant:string,q:QuoteRow):Promise<void>{
 for(const l of q.lines){
  if(!l.scopedPromotion)continue;
  if(!q.session_id||q.session_id!==l.scopedPromotion.sessionId||l.qty!==1||l.promotion!==null)fail('PROMOTION_LIMIT_EXCEEDED');
  if(!(await db.query('SELECT bitpos.promotion_eligible($1::uuid,$2::uuid,$3::uuid) AS eligible',[merchant,l.scopedPromotion.targetId,q.session_id])).rows[0].eligible)fail('PROMOTION_OFFER_INVALID');
 }
}
export async function freezeScopedOrder(db:pg.PoolClient,merchant:string,orderId:string,q:QuoteRow){
 for(const l of q.lines){if(!l.scopedPromotion)continue;
  const claimed=await db.query('UPDATE scoped_offer_eligibility SET order_id=$3 WHERE merchant_id=$1 AND target_id=$2 AND session_id=$4 AND order_id IS NULL RETURNING target_id',[merchant,l.scopedPromotion.targetId,orderId,q.session_id]);if(!claimed.rowCount)fail('PROMOTION_OFFER_INVALID');
  await db.query('INSERT INTO order_scoped_promotions(merchant_id,order_id,product_id,quote_id,target_id,evidence) VALUES($1,$2,$3,$4,$5,$6)',[merchant,orderId,l.productId,q.id,l.scopedPromotion.targetId,l.scopedPromotion]);
 }
}
export async function freezeScopedQuote(db:pg.PoolClient,merchant:string,quoteId:string,lines:EffectiveLine[]){
 for(const l of lines){if(l.scopedPromotion)await db.query('INSERT INTO quote_scoped_promotions(merchant_id,quote_id,product_id,target_id,evidence) VALUES($1,$2,$3,$4,$5)',[merchant,quoteId,l.productId,l.scopedPromotion.targetId,l.scopedPromotion]);}
}
