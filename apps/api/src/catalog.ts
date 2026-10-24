import {eligibleBundles,bundleQuoteLines,validateBundleQuote} from './bundle-promotions';
import type pg from 'pg';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {EffectiveLine,PriceConfiguration,Quote,OrderAuthority} from '../../../packages/contracts/src/index';
import {hash,MINT,TOKEN_PROGRAM,DEVNET_GENESIS,canonicalItems} from '../../../packages/domain/src/index';
import {money,settlement} from '../../../packages/domain/src/table-pricing';
import {effectivePrice,priceLease} from '../../../packages/domain/src/pricing';
import {offerFromRow} from './offers';
import {audit} from './db';
import {fail,integer,positive,uuid,label,routingLock,requireRole} from './authority';
import type {QuoteRow,CatalogSnapshot} from './types';
import type {EffectiveMenu} from './offers';
import {scopePromotionMenu,validateScopedQuote,freezeScopedQuote} from './scoped-offers';
import {validateOccupancyQuote} from './table-occupancy';
import {dailyPromotionMenu,freezeDailyQuote,validateDailyQuote} from './daily-promotions';
import {personalPromotionMenu,freezePersonalQuote,validatePersonalQuote} from './personal-promotions';
import type {MobileConfiguredCartItem} from '../../../packages/contracts/src/mobile-v1.generated';
import {aggregateConfiguredCart} from './online-options';
import {configuredItems,configuredSnapshot,configuredRequestHash,freezeConfiguredQuote,validateConfiguredQuote} from './configured-food';
import {captureDeliverySnapshot,deliveryConfiguredSnapshot,deliveryRequestHash,freezeDeliverySnapshot,type DeliverySelection} from './food-delivery';
export async function pricingView(db:pg.PoolClient,merchant:string){const row=(await db.query('SELECT v.*,p.revision::text FROM merchant_pricing p JOIN catalog_price_versions v ON v.merchant_id=p.merchant_id AND v.id=p.active_price_version_id WHERE p.merchant_id=$1',[merchant])).rows[0];return {configured:!!row,revision:row?.revision??'0',priceVersion:row?.id??null,catalogCurrency:row?.currency??null,decimals:row?.decimals??null,provenance:row?{kind:row.provenance,...(row.demo_label?{label:row.demo_label}:{})}:null,prices:row?(await db.query('SELECT product_id AS "productId",unit_minor::text AS "unitMinor" FROM catalog_prices WHERE merchant_id=$1 AND price_version_id=$2 ORDER BY product_id',[merchant,row.id])).rows:[],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,genesisHash:DEVNET_GENESIS,decimals:6,quotePolicy:row?.quote_policy??null}};}
export const priceConfiguration=z.object({expectedRevision:integer,catalogCurrency:z.enum(['USD','USDG']),catalogDecimals:z.union([z.literal(2),z.literal(4),z.literal(6)]).optional(),provenance:z.discriminatedUnion('kind',[z.object({kind:z.literal('owner_configured')}).strict(),z.object({kind:z.literal('demo_configured'),label}).strict()]),prices:z.array(z.object({productId:uuid,unitMinor:positive}).strict()).min(1),settlement:z.object({asset:z.literal('USDG'),network:z.literal('solana:devnet'),mint:z.literal(MINT),tokenProgram:z.literal(TOKEN_PROGRAM),decimals:z.literal(6),quotePolicy:z.enum(['USD_CENTS_TO_USDG_1_TO_1','USD_FIXED4_TO_USDG_1_TO_1','USDG_RAW_IDENTITY'])}).strict()}).strict();
export async function publishPrices(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){requireRole(role,true);const d:PriceConfiguration=priceConfiguration.parse(input);await routingLock(db,merchant);const current=await pricingView(db,merchant);if(current.revision!==d.expectedRevision)fail('PRICE_VERSION_CHANGED');const decimals=d.catalogDecimals??(d.catalogCurrency==='USD'?2:6);if(d.catalogCurrency==='USD'?(decimals!==2&&decimals!==4||d.settlement.quotePolicy!==(decimals===4?'USD_FIXED4_TO_USDG_1_TO_1':'USD_CENTS_TO_USDG_1_TO_1')):(decimals!==6||d.settlement.quotePolicy!=='USDG_RAW_IDENTITY'))fail('INVALID_CURRENCY',422);
 const products=(await db.query('SELECT id,name,name_en,category,catalog_key FROM products WHERE merchant_id=$1 ORDER BY id',[merchant])).rows;const ids=new Set(d.prices.map(p=>p.productId));if(ids.size!==d.prices.length||products.length!==ids.size||products.some(p=>!ids.has(p.id)))fail('CATALOG_INCOMPLETE',422);for(const p of products){label.parse(p.name);label.parse(p.name_en);if(p.category)label.parse(p.category);if(p.catalog_key)label.parse(p.catalog_key);}for(const p of d.prices){try{settlement(d.catalogCurrency,BigInt(p.unitMinor)*100n, 'configured',decimals);}catch{fail('INVALID_PRICE',422);}}
 const id=randomUUID();await db.query('INSERT INTO catalog_price_versions(merchant_id,id,currency,decimals,configured_by,provenance,demo_label,quote_policy) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[merchant,id,d.catalogCurrency,decimals,actor,d.provenance.kind,d.provenance.kind==='demo_configured'?d.provenance.label:null,d.settlement.quotePolicy]);for(const p of d.prices)await db.query('INSERT INTO catalog_prices(merchant_id,price_version_id,product_id,unit_minor) VALUES($1,$2,$3,$4)',[merchant,id,p.productId,p.unitMinor]);await db.query('INSERT INTO merchant_pricing(merchant_id,active_price_version_id,revision) VALUES($1,$2,1) ON CONFLICT(merchant_id) DO UPDATE SET active_price_version_id=$2,revision=merchant_pricing.revision+1',[merchant,id]);await audit(db,merchant,actor,'pricing.publish',id);return pricingView(db,merchant);
}
export async function effectiveCatalog(db:pg.PoolClient,merchant:string,tableId:string|null=null):Promise<EffectiveMenu>{
 const data=(await db.query<CatalogSnapshot>(`WITH moment AS MATERIALIZED(SELECT clock_timestamp() AS as_of) SELECT moment.as_of,(SELECT jsonb_build_object('id',id,'name',name) FROM merchants WHERE id=$1) AS merchant,(SELECT to_jsonb(v)||jsonb_build_object('revision',m.revision::text) FROM merchant_pricing m JOIN catalog_price_versions v ON v.merchant_id=m.merchant_id AND v.id=m.active_price_version_id WHERE m.merchant_id=$1) AS config,coalesce((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('unit_minor',c.unit_minor::text,'offer',CASE WHEN o.revision IS NULL THEN NULL ELSE to_jsonb(o)||jsonb_build_object('revision',o.revision::text,'base_minor',o.base_minor::text,'current_minor',o.current_minor::text,'amount_minor',o.amount_minor::text) END) ORDER BY p.sort_order,p.id) FROM products p LEFT JOIN merchant_pricing m ON m.merchant_id=p.merchant_id LEFT JOIN catalog_prices c ON c.merchant_id=p.merchant_id AND c.product_id=p.id AND c.price_version_id=m.active_price_version_id LEFT JOIN LATERAL(SELECT * FROM versioned_product_offers o WHERE o.merchant_id=p.merchant_id AND o.product_id=p.id AND o.price_version_id=c.price_version_id ORDER BY revision DESC LIMIT 1)o ON true WHERE p.merchant_id=$1),'[]'::jsonb) AS products FROM moment`,[merchant])).rows[0];
 const asOf=new Date(data.as_of);const config=data.config;const products=data.products.map(p=>{const e=p.unit_minor&&config?effectivePrice(BigInt(p.unit_minor),offerFromRow(p.offer),asOf):null;return {id:p.id,catalogKey:p.catalog_key,name:p.name,nameEn:p.name_en,emoji:p.emoji,available:p.stock-p.reserved,imageUrl:p.image_url,category:p.category,description:p.description,basePrice:e&&config?money(config.currency,e.basePriceMinor,config.decimals):null,unitPrice:e&&config?money(config.currency,e.priceMinor,config.decimals):null,promotion:e?.promotion&&config?{...e.promotion,priceVersion:config.id}:null};});
 const menu=await dailyPromotionMenu(db,merchant,{merchant:data.merchant,asOf:asOf.toISOString(),priceValidUntil:priceLease(asOf,products.map(p=>p.promotion)),menuVersion:hash(JSON.stringify({config,products})),priceVersion:config?.id??null,pricingRevision:config?.revision??'0',currency:config?.currency??null,decimals:config?.decimals??null,products},tableId);const bundles=await eligibleBundles(db,merchant,tableId,menu.priceVersion);return {...menu,bundles,menuVersion:hash(menu.menuVersion+JSON.stringify(bundles)),priceValidUntil:bundles.length?new Date(Math.min(Date.parse(menu.priceValidUntil),...bundles.map(b=>Date.parse(b.expiresAt)))).toISOString():menu.priceValidUntil};
}
export function quoteView(q:Omit<QuoteRow,'quoted_at'|'valid_until'>&{quoted_at:Date|string;valid_until:Date|string}):Quote { return {id:q.id,priceVersion:q.price_version_id,pricingRevision:String(q.pricing_revision),cartVersion:q.cart_version===null?null:String(q.cart_version),lines:q.lines,total:money(q.lines[0].unitPrice.currency,q.total_minor,q.lines[0].unitPrice.decimals),settlement:q.settlement,quotedAt:new Date(q.quoted_at).toISOString(),validUntil:new Date(q.valid_until).toISOString()}; }
/** JSONB reorders object keys; fingerprint an explicit value tuple, not its property order. */
export function quoteRequestHash(items:{productId:string;qty:number}[],customerId:string|undefined,serving:Extract<OrderAuthority,{kind:'versioned'}>['serving']){
 return hash(JSON.stringify([items,customerId??null,serving.kind,serving.kind==='table'?serving.tableId:null,serving.label]));
}
export type QuoteOrigin=
 | {kind:'register'|'device';id:string;sessionId?:string;cartVersion?:string}
 | {kind:'online';id:string;branchId:string;sessionId?:never;cartVersion?:never};
export function captureQuote(db:pg.PoolClient,merchant:string,origin:Extract<QuoteOrigin,{kind:'online'}>,itemsInput:MobileConfiguredCartItem[],authority:Extract<OrderAuthority,{kind:'versioned'}>,customerId?:string,delivery?:DeliverySelection):Promise<QuoteRow>;
export function captureQuote(db:pg.PoolClient,merchant:string,origin:Exclude<QuoteOrigin,{kind:'online'}>,itemsInput:{productId:string;qty:number}[],authority:Extract<OrderAuthority,{kind:'versioned'}>,customerId?:string):Promise<QuoteRow>;
export async function captureQuote(db:pg.PoolClient,merchant:string,origin:QuoteOrigin,itemsInput:{productId:string;qty:number}[]|MobileConfiguredCartItem[],authority:Extract<OrderAuthority,{kind:'versioned'}>,customerId?:string,delivery?:DeliverySelection){
 const configurations=origin.kind==='online'?configuredItems(itemsInput):null;
 const items=configurations?aggregateConfiguredCart(configurations):canonicalItems(itemsInput);const tableId=authority.serving.kind==='table'?authority.serving.tableId:null;const menu=await personalPromotionMenu(db,merchant,await scopePromotionMenu(db,merchant,await effectiveCatalog(db,merchant,tableId),origin.sessionId??null),origin.sessionId??null);if(!menu.priceVersion||!menu.currency)fail('SETUP_REQUIRED');let lines:EffectiveLine[]=items.map(i=>{const p=menu.products.find(p=>p.id===i.productId);if(!p)fail('RESOURCE_NOT_FOUND',404);if(!p.unitPrice||p.available<i.qty)fail('STOCK_UNAVAILABLE');if((p.scopedPromotion||p.personalPromotion)&&i.qty!==1)fail('PROMOTION_LIMIT_EXCEEDED');return {productId:i.productId,name:p.name,nameEn:p.nameEn,qty:i.qty,priceVersion:menu.priceVersion!,basePrice:p.basePrice!,unitPrice:p.unitPrice,promotion:p.promotion,...(p.scopedPromotion?{scopedPromotion:p.scopedPromotion}:{}),...(p.dailyPromotion?{dailyPromotion:p.dailyPromotion}:{}),...(p.personalPromotion?{personalPromotion:p.personalPromotion}:{})};});
 lines=await bundleQuoteLines(db,merchant,lines,tableId,menu.priceVersion);
 let configuration=configurations?await configuredSnapshot(db,merchant,configurations,lines):null;
 const id=randomUUID();
 if((authority.serving.kind==='delivery')!==!!delivery)fail('INVALID_REQUEST',422);
 const destination=delivery&&origin.kind==='online'?await captureDeliverySnapshot(db,merchant,origin.branchId,origin.id,id,delivery,menu.priceVersion):null;
 if(destination&&configuration)configuration=deliveryConfiguredSnapshot(configuration,destination);
 const total=configuration?BigInt(configuration.total.amountMinor):lines.reduce((n,l)=>n+BigInt(l.unitPrice.amountMinor)*BigInt(l.qty),0n);
 const store=(await db.query('SELECT treasury FROM merchants WHERE id=$1',[merchant])).rows[0];
 let asset;try{asset=settlement(menu.currency,total,store.treasury,menu.decimals!);}catch{fail('INVALID_PRICE',422);}
 const requestHash=origin.kind==='online'?(destination?await deliveryRequestHash(db,origin.id,origin.branchId,configurations!,destination):await configuredRequestHash(db,origin.id,origin.branchId,configurations!)):quoteRequestHash(items,customerId,authority.serving);
 const q=(await db.query<QuoteRow>(`INSERT INTO order_quotes(
  merchant_id,id,origin_kind,origin_id,source_register_id,source_device_id,session_id,cart_version,
  price_version_id,pricing_revision,cart,lines,total_minor,usdg_minor,treasury,settlement,authority,
  request_hash,quoted_at,valid_until,source_account_id,source_branch_id,configured_food_version)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
 [merchant,id,origin.kind,origin.id,origin.kind==='register'?origin.id:null,origin.kind==='device'?origin.id:null,
  origin.sessionId??null,origin.cartVersion??null,menu.priceVersion,menu.pricingRevision,JSON.stringify(items),
  JSON.stringify(lines),String(total),asset.amountMinor,store.treasury,asset,authority,requestHash,
  menu.asOf,menu.priceValidUntil,origin.kind==='online'?origin.id:null,origin.kind==='online'?origin.branchId:null,origin.kind==='online'?1:null])).rows[0];
 if(destination)await freezeDeliverySnapshot(db,destination);
 if(configurations&&configuration)await freezeConfiguredQuote(db,merchant,id,configurations,configuration);
 await freezeScopedQuote(db,merchant,id,lines);
 await freezeDailyQuote(db,merchant,id,lines);
 await freezePersonalQuote(db,merchant,id,lines);
 return q;
}
export async function validateQuote(db:pg.PoolClient,merchant:string,q:QuoteRow) {
 await validateOccupancyQuote(db,merchant,q.id,q.authority.serving.kind==='table'?q.authority.serving.tableId:null);
 if(q.origin_kind==='online')await validateConfiguredQuote(db,merchant,q.id,q.lines,q.authority.serving.kind==='delivery');
 const products=(await db.query('SELECT id,stock,reserved FROM products WHERE merchant_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[merchant,q.cart.map(i=>i.productId)])).rows;
 await validateBundleQuote(db,merchant,q);
 await validateScopedQuote(db,merchant,q);
 await validateDailyQuote(db,merchant,q);
 await validatePersonalQuote(db,merchant,q);
 const tableId=q.authority.serving.kind==='table'?q.authority.serving.tableId:null;const menu=await personalPromotionMenu(db,merchant,await scopePromotionMenu(db,merchant,await effectiveCatalog(db,merchant,tableId),q.session_id),q.session_id);
 if(menu.priceVersion!==q.price_version_id)fail('PRICE_VERSION_CHANGED');if(new Date(q.valid_until).getTime()<=Date.parse(menu.asOf))fail('QUOTE_EXPIRED');
 const store=(await db.query('SELECT treasury FROM merchants WHERE id=$1',[merchant])).rows[0];if(store.treasury!==q.treasury||menu.pricingRevision!==String(q.pricing_revision))fail('QUOTE_CHANGED');
 const freshLines=await bundleQuoteLines(db,merchant,q.lines.map(line=>{const p=menu.products.find(p=>p.id===line.productId);if(!p?.unitPrice)fail('QUOTE_CHANGED');return {...line,unitPrice:p.unitPrice,promotion:p.promotion,bundle:undefined};}),tableId,q.price_version_id);
 for(const line of q.lines){
  const p=products.find(p=>p.id===line.productId);if(!p||p.stock-p.reserved<line.qty)fail('STOCK_UNAVAILABLE');
  if(line.bundle){const fresh=freshLines.find(l=>l.productId===line.productId);if(fresh?.unitPrice.amountMinor!==line.unitPrice.amountMinor||fresh.bundle?.campaignId!==line.bundle.campaignId||fresh.bundle?.campaignVersion!==line.bundle.campaignVersion)fail('QUOTE_CHANGED');continue;}
  const e=menu.products.find(p=>p.id===line.productId);
  if(!e?.unitPrice||e.unitPrice.currency!==line.unitPrice.currency||e.unitPrice.decimals!==line.unitPrice.decimals||e.unitPrice.amountMinor!==line.unitPrice.amountMinor||e.promotion?.revision!==line.promotion?.revision||e.promotion?.priceVersion!==line.promotion?.priceVersion||e.scopedPromotion?.targetId!==line.scopedPromotion?.targetId||e.scopedPromotion?.campaignVersion!==line.scopedPromotion?.campaignVersion||e.dailyPromotion?.campaignId!==line.dailyPromotion?.campaignId||e.dailyPromotion?.campaignVersion!==line.dailyPromotion?.campaignVersion||e.personalPromotion?.targetId!==line.personalPromotion?.targetId||e.personalPromotion?.campaignVersion!==line.personalPromotion?.campaignVersion||e.personalPromotion?.recipientId!==line.personalPromotion?.recipientId||e.personalPromotion?.occupancyGeneration!==line.personalPromotion?.occupancyGeneration)fail('QUOTE_CHANGED');
 }
}
