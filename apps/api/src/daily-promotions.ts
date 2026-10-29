import type pg from 'pg';
import type {EffectiveLine} from '../../../packages/contracts/src/index';
import type {DailyPromotionLine} from '../../../packages/contracts/src/daily-promotions';
import type {EffectiveMenu} from './offers';
import type {QuoteRow} from './types';
import {hash} from '../../../packages/domain/src/index';
import {promotionPrice} from '../../../packages/domain/src/promotions';
import {fail} from './authority';
/** Public daily authority is merchant-wide; table derivations require an original live destination. */
export async function dailyPromotionMenu(db:pg.PoolClient,merchant:string,menu:EffectiveMenu,tableId:string|null=null):Promise<EffectiveMenu>{
 const rows=(await db.query(`SELECT c.id,c.approved_version,c.product_id,c.starts_at,c.expires_at,r.content,s.minimum_unit_minor::text
 FROM promotion_campaigns c JOIN promotion_scopes s ON s.merchant_id=c.merchant_id AND s.campaign_id=c.id AND s.audience='daily'
 JOIN promotion_revisions r ON r.merchant_id=c.merchant_id AND r.campaign_id=c.id AND r.version=c.approved_version
 LEFT JOIN promotion_scope_placements x ON x.merchant_id=c.merchant_id AND x.campaign_id=c.id
 WHERE c.merchant_id=$1 AND NOT (r.content->'snapshot' ? 'bundle') AND c.state='APPROVED' AND c.starts_at<=$2::timestamptz AND c.expires_at>$2::timestamptz
 AND (x.binding->'placement'->>'kind' IS DISTINCT FROM 'table' OR $3::uuid IS NOT NULL AND (x.binding->'placement'->>'tableId')::uuid=$3 AND bitpos.promotion_table_binding_current(c.merchant_id,c.id))
 AND EXISTS(SELECT 1 FROM promotion_playlist_targets t WHERE t.merchant_id=c.merchant_id AND t.campaign_id=c.id AND t.campaign_version=c.approved_version AND t.audience='daily' AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') AND t.expires_at>$2::timestamptz)
 ORDER BY c.approved_version DESC,c.id`,[merchant,menu.asOf,tableId])).rows;
 if(!rows.length)return menu;
 const selected=new Map<string,{unitPrice:NonNullable<EffectiveMenu['products'][number]['unitPrice']>;dailyPromotion:DailyPromotionLine}>();
 for(const row of rows){
  const product=menu.products.find(p=>p.id===row.product_id),approved=row.content.snapshot;
  if(!product?.basePrice||!product.unitPrice||product.available<1||menu.priceVersion!==approved.priceVersion||product.basePrice.amountMinor!==approved.basePrice.amountMinor||product.imageUrl!==approved.imageUrl)continue;
  let unitPrice;try{unitPrice=promotionPrice(product.basePrice,product.unitPrice,row.content.discountPercent,row.content.discountPercent);}catch{continue;}
  if(BigInt(unitPrice.amountMinor)<BigInt(row.minimum_unit_minor))continue;
  const prior=selected.get(product.id);if(prior&&BigInt(prior.unitPrice.amountMinor)<=BigInt(unitPrice.amountMinor))continue;
  selected.set(product.id,{unitPrice,dailyPromotion:{campaignId:row.id,campaignVersion:row.approved_version,discountPercent:row.content.discountPercent,startsAt:new Date(row.starts_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString()}});
 }
 if(!selected.size)return menu;
 const expiry=Math.min(Date.parse(menu.priceValidUntil),...Array.from(selected.values(),v=>Date.parse(v.dailyPromotion.expiresAt)));
 return {...menu,priceValidUntil:new Date(expiry).toISOString(),menuVersion:hash(menu.menuVersion+JSON.stringify(Array.from(selected))),products:menu.products.map(p=>{const daily=selected.get(p.id);return daily?{...p,...daily,promotion:null}:p;})};
}
export async function validateDailyQuote(db:pg.PoolClient,merchant:string,q:QuoteRow){
 for(const line of q.lines){const d=line.dailyPromotion;if(!d)continue;
  const tableId=q.authority.serving.kind==='table'?q.authority.serving.tableId:null;
  if(!(await db.query(`SELECT 1 FROM promotion_campaigns c JOIN promotion_scopes s ON s.merchant_id=c.merchant_id AND s.campaign_id=c.id AND s.audience='daily' LEFT JOIN promotion_scope_placements x ON x.merchant_id=c.merchant_id AND x.campaign_id=c.id WHERE c.merchant_id=$1 AND c.id=$2 AND c.approved_version=$3 AND c.state='APPROVED' AND c.starts_at<=clock_timestamp() AND c.expires_at>clock_timestamp() AND (x.binding->'placement'->>'kind' IS DISTINCT FROM 'table' OR (x.binding->'placement'->>'tableId')::uuid=$4::uuid AND x.binding->'placement'->'deviceIds'->>0=$5 AND bitpos.promotion_table_binding_current(c.merchant_id,c.id)) AND EXISTS(SELECT 1 FROM promotion_playlist_targets t WHERE t.merchant_id=c.merchant_id AND t.campaign_id=c.id AND t.campaign_version=c.approved_version AND t.audience='daily' AND t.state IN ('QUEUED','DEFERRED_BUSY','DEFERRED_OFFLINE','DELIVERED','RENDERED','UNSUPPORTED') AND t.expires_at>clock_timestamp())`,[merchant,d.campaignId,d.campaignVersion,tableId,q.authority.target?.deviceId??null])).rowCount)fail('PROMOTION_OFFER_INVALID');
 }
}
export async function freezeDailyQuote(db:pg.PoolClient,merchant:string,quoteId:string,lines:EffectiveLine[]){
 for(const line of lines)if(line.dailyPromotion)await db.query('INSERT INTO daily_quote_promotions VALUES($1,$2,$3,$4,$5,$6)',[merchant,quoteId,line.productId,line.dailyPromotion.campaignId,line.dailyPromotion.campaignVersion,line.dailyPromotion]);
}
export async function freezeDailyOrder(db:pg.PoolClient,merchant:string,orderId:string,q:QuoteRow){
 for(const line of q.lines)if(line.dailyPromotion)await db.query('INSERT INTO daily_order_promotions VALUES($1,$2,$3,$4,$5,$6,$7)',[merchant,orderId,line.productId,q.id,line.dailyPromotion.campaignId,line.dailyPromotion.campaignVersion,line.dailyPromotion]);
}
