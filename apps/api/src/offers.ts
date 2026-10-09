import type pg from 'pg';
import {z} from 'zod';
import {audit} from './db';
import {discountedMinor,effectivePrice,priceLease,type ProductOffer} from '../../../packages/domain/src/pricing';
import type {Money,ActiveFoodPromotion} from '../../../packages/contracts/src/index';
import {money} from '../../../packages/domain/src/table-pricing';
import {fail,routingLock,requireRole,uuid,integer,positive} from './authority';
import {effectiveCatalog} from './catalog';

export interface EffectiveMenu {
 merchant:{id:string;name:string};asOf:string;priceValidUntil:string;
 menuVersion:string;priceVersion:string|null;pricingRevision:string;currency:'USD'|'USDG'|null;decimals:number|null;
 products:{id:string;catalogKey:string|null;name:string;nameEn:string;emoji:string;available:number;imageUrl:unknown;category:unknown;description:unknown;basePrice:Money|null;unitPrice:Money|null;promotion:(ActiveFoodPromotion&{priceVersion:string})|null}[];
}
const discount=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('amount'),amountMinor:positive}).strict(),
 z.object({kind:z.literal('percent'),percent:z.number().int().min(1).max(99)}).strict()
]);
export const enableOffer=z.object({priceVersion:uuid,expectedRevision:integer,enabled:z.literal(true),basePriceMinor:positive,currentPriceMinor:positive,expiresAt:z.string().datetime({offset:true}).refine(value=>Number.isFinite(Date.parse(value))),discount}).strict();
export const disableOffer=z.object({priceVersion:uuid,expectedRevision:integer,enabled:z.literal(false)}).strict();
const storedOffer=z.object({revision:positive,enabled:z.boolean(),base_minor:positive,current_minor:positive,expires_at:z.union([z.string(),z.date()]),kind:z.enum(['amount','percent']),amount_minor:positive.nullable(),percent:z.number().int().min(1).max(99).nullable()});
export function offerFromRow(value:unknown):ProductOffer|null {
 if(value===null||value===undefined)return null;
 const row=storedOffer.parse(value);
 if(row.kind==='amount'&&row.amount_minor===null||row.kind==='percent'&&row.percent===null)throw Error('Invalid stored offer');
 const offer:ProductOffer={revision:row.revision,enabled:row.enabled,baseMinor:BigInt(row.base_minor),currentMinor:BigInt(row.current_minor),expiresAt:new Date(row.expires_at).toISOString(),discount:row.kind==='amount'?{kind:'amount',amountMinor:row.amount_minor!}:{kind:'percent',percent:row.percent!}};
 if(offer.currentMinor<=0n||offer.currentMinor>=offer.baseMinor||discountedMinor(offer.baseMinor,offer.discount)!==offer.currentMinor)throw Error('Invalid stored offer');
 return offer;
}
export async function productOffer(db:pg.PoolClient,merchant:string,actor:string,role:string,productId:string,method:string,input:unknown,requestedVersion?:string){
 requireRole(role);uuid.parse(productId);await routingLock(db,merchant);
 const d=method==='PUT'?enableOffer.parse(input):method==='PATCH'?disableOffer.parse(input):null;
 if(!['GET','PUT','PATCH'].includes(method))fail('RESOURCE_NOT_FOUND',404);
 const active=(await db.query('SELECT active_price_version_id FROM merchant_pricing WHERE merchant_id=$1',[merchant])).rows[0]?.active_price_version_id;
 const version=d?.priceVersion??requestedVersion??active;if(!version)fail('SETUP_REQUIRED');uuid.parse(version);
 const p=(await db.query('SELECT c.unit_minor::text,v.currency FROM catalog_prices c JOIN catalog_price_versions v ON v.merchant_id=c.merchant_id AND v.id=c.price_version_id WHERE c.merchant_id=$1 AND c.product_id=$2 AND c.price_version_id=$3',[merchant,productId,version])).rows[0];if(!p)fail('RESOURCE_NOT_FOUND',404);
 let row=(await db.query('SELECT * FROM versioned_product_offers WHERE merchant_id=$1 AND product_id=$2 AND price_version_id=$3 ORDER BY revision DESC LIMIT 1',[merchant,productId,version])).rows[0];
 const asOf=new Date((await db.query('SELECT clock_timestamp() AS now')).rows[0].now);
 if(d){
 if(version!==active)fail('PRICE_VERSION_CHANGED');if(d.expectedRevision!==String(row?.revision??'0'))fail('QUOTE_CHANGED');
 if(d.enabled){if(d.basePriceMinor!==p.unit_minor||discountedMinor(BigInt(p.unit_minor),d.discount)!==BigInt(d.currentPriceMinor)||BigInt(d.currentPriceMinor)>=BigInt(p.unit_minor)||Date.parse(d.expiresAt)<=asOf.getTime())fail('INVALID_PRICE',422);row={base_minor:p.unit_minor,current_minor:d.currentPriceMinor,expires_at:d.expiresAt,kind:d.discount.kind,amount_minor:d.discount.kind==='amount'?d.discount.amountMinor:null,percent:d.discount.kind==='percent'?d.discount.percent:null};}else if(!row)fail('QUOTE_CHANGED');
 row=(await db.query('INSERT INTO versioned_product_offers(merchant_id,product_id,price_version_id,revision,enabled,base_minor,current_minor,expires_at,kind,amount_minor,percent) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[merchant,productId,version,String(BigInt(d.expectedRevision)+1n),d.enabled,row.base_minor,row.current_minor,row.expires_at,row.kind,row.amount_minor,row.percent])).rows[0];
 await db.query('UPDATE merchant_pricing SET revision=revision+1 WHERE merchant_id=$1',[merchant]);await audit(db,merchant,actor,d.enabled?'product.offer.enable':'product.offer.disable',productId);
 }
 const offer=offerFromRow(row);const e=effectivePrice(BigInt(p.unit_minor),offer,asOf);
 return {productId,priceVersion:version,asOf:asOf.toISOString(),offer:offer?{priceVersion:version,revision:offer.revision,enabled:offer.enabled,basePriceMinor:offer.baseMinor.toString(),currentPriceMinor:offer.currentMinor.toString(),expiresAt:offer.expiresAt,discount:offer.discount}:null,active:e.promotion!==null,effective:{basePrice:money(p.currency,e.basePriceMinor),unitPrice:money(p.currency,e.priceMinor),promotion:e.promotion?{...e.promotion,priceVersion:version}:null}};
}
export const effectiveMenu=effectiveCatalog;
