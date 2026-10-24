import type pg from 'pg';
import type {EffectiveLine} from '../../../packages/contracts/src/index';
import type {BundleOffer,BundleSnapshot} from '../../../packages/contracts/src/bundle-promotions';
import {applyBundle,bundleSnapshot,aggregateBundle} from '../../../packages/domain/src/bundle-promotions';
import {promotionProducts} from './promotions';
import {fail} from './authority';
export async function freshBundle(db:pg.PoolClient,merchant:string,bundle:BundleSnapshot,tableId:string|null){return aggregateBundle(bundleSnapshot(await promotionProducts(db,merchant,bundle.members.map(m=>m.productId),tableId),bundle.unitPrice.amountMinor));}
export async function eligibleBundles(db:pg.PoolClient,merchant:string,tableId:string|null,priceVersion:string|null):Promise<BundleOffer[]>{
 if(!priceVersion)return [];
 const rows=(await db.query("SELECT c.id,c.approved_version,r.content,c.expires_at FROM promotion_campaigns c JOIN promotion_revisions r ON r.merchant_id=c.merchant_id AND r.campaign_id=c.id AND r.version=c.approved_version WHERE c.merchant_id=$1 AND r.content->'snapshot' ? 'bundle' AND bitpos.bundle_campaign_current(c.merchant_id,c.id,$2,$3) ORDER BY c.created_at,c.id",[merchant,tableId,priceVersion])).rows;
 return rows.map(r=>{const s=r.content.snapshot,b=s.bundle;return {id:r.id,version:r.approved_version,name:b.members.map((m:any)=>m.name).join(' + '),nameEn:b.members.map((m:any)=>m.nameEn).join(' + '),basePrice:s.basePrice,unitPrice:b.unitPrice,discountLabel:b.discountLabel,members:b.members.map((m:any)=>({productId:m.productId,qty:1,imageUrl:m.imageUrl})),expiresAt:new Date(r.expires_at).toISOString()};});
}
export async function bundleQuoteLines(db:pg.PoolClient,merchant:string,lines:EffectiveLine[],tableId:string|null,version:string){return applyBundle(lines,await eligibleBundles(db,merchant,tableId,version));}
export async function validateBundleQuote(db:pg.PoolClient,merchant:string,q:{lines:EffectiveLine[];price_version_id:string;authority:{serving:{kind:string;tableId?:string}}}){for(const l of q.lines)if(l.bundle&&!((await db.query('SELECT bundle_campaign_current($1,$2,$3,$4) AS valid',[merchant,l.bundle.campaignId,q.authority.serving.kind==='table'?q.authority.serving.tableId:null,q.price_version_id])).rows[0]?.valid))fail('PROMOTION_OFFER_INVALID');}
