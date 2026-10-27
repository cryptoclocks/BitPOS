import type pg from 'pg';
import {randomUUID} from 'node:crypto';
import {hash} from '../../../packages/domain/src/index';
import type {CartItem,EffectiveLine,Money} from '../../../packages/contracts/src/index';
import {MobileProductOptionsSchema,OnlineOptionsPublicationSchema,type MobileMoney,type MobileProductOptions,type MobileConfiguredCartItem,type MobileConfiguredFoodLine} from '../../../packages/contracts/src/mobile-v1.generated';
import {audit} from './db';
import {fail,requireRole,routingLock} from './authority';

const noOptions:MobileProductOptions={version:null,revision:'0',noteEnabled:true,groups:[]};
const control=/[\u0000-\u001f\u007f-\u009f]/u;
const maxMinor=999999999999999999n;
type Denomination=Pick<MobileMoney,'currency'|'decimals'>;
function sameDenomination(a:Denomination,b:Denomination){return a.currency===b.currency&&a.decimals===b.decimals;}
/** Validate configuration business rules after strict transport parsing. */
export function validateOptionGroups(options:MobileProductOptions,price:Denomination){
 const groups=new Set<string>();
 for(const g of options.groups){
  if(groups.has(g.id.toLowerCase())||control.test(g.name)||control.test(g.nameEn)||g.minSelections>g.maxSelections)fail('INVALID_REQUEST',422);groups.add(g.id.toLowerCase());
  const choices=new Set<string>();let capacity=0;
  for(const c of g.choices){
   if(choices.has(c.id.toLowerCase())||control.test(c.name)||control.test(c.nameEn)||!sameDenomination(c.priceDelta,price)||BigInt(c.priceDelta.amountMinor)>maxMinor)fail('INVALID_REQUEST',422);choices.add(c.id.toLowerCase());
   if(c.enabled)capacity+=c.maxQty;
  }
  if(g.enabled&&capacity<g.minSelections)fail('INVALID_REQUEST',422);
 }
}
/** Real product aggregate feeds unchanged promotions and stock reservation. */
export function aggregateConfiguredCart(items:readonly MobileConfiguredCartItem[]):CartItem[]{
 const ids=new Set<string>(),quantities=new Map<string,number>();
 for(const item of items){
  if(ids.has(item.lineId))fail('INVALID_REQUEST',422);ids.add(item.lineId);
  const qty=(quantities.get(item.productId)??0)+item.qty;if(qty>100)fail('INVALID_REQUEST',422);quantities.set(item.productId,qty);
 }
 return [...quantities].map(([productId,qty])=>({productId,qty})).sort((a,b)=>a.productId.localeCompare(b.productId));
}
/** Hash only explicit normalized request values; never JSON object key order. */
export function configuredCartHash(items:readonly MobileConfiguredCartItem[]){
 return hash(JSON.stringify([...items].sort((a,b)=>a.lineId.localeCompare(b.lineId)).map(i=>[i.lineId,i.productId,i.qty,i.optionVersion,[...i.selections].sort((a,b)=>a.groupId.localeCompare(b.groupId)||a.choiceId.localeCompare(b.choiceId)).map(s=>[s.groupId,s.choiceId,s.qty]),i.allergyNote])));
}
/** Resolve frozen product components plus non-discounted per-unit additions. */
export function configuredLines(items:readonly MobileConfiguredCartItem[],products:readonly EffectiveLine[],options:ReadonlyMap<string,MobileProductOptions>):MobileConfiguredFoodLine[]{
 aggregateConfiguredCart(items);
 const byProduct=new Map(products.map(p=>[p.productId,p]));
 return [...items].sort((a,b)=>a.lineId.localeCompare(b.lineId)).map(item=>{
  const p=byProduct.get(item.productId);if(!p)fail('INVALID_REQUEST',422);
  const o=options.get(item.productId)??noOptions;
  if(o.version!==item.optionVersion)fail('QUOTE_CHANGED',409,{productId:item.productId,reason:'OPTIONS_CHANGED'});
  if(item.allergyNote!==null&&(!o.noteEnabled||item.allergyNote.length>300||Buffer.byteLength(item.allergyNote)>1200||/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u.test(item.allergyNote)))fail('INVALID_REQUEST',422);
  const counts=new Map<string,number>(),selected=new Set<string>();let additions=0n;
  const selections=[...item.selections].sort((a,b)=>a.groupId.localeCompare(b.groupId)||a.choiceId.localeCompare(b.choiceId)).map(s=>{
   const key=s.groupId+':'+s.choiceId,g=o.groups.find(g=>g.id===s.groupId),c=g?.choices.find(c=>c.id===s.choiceId);
   if(selected.has(key)||!g?.enabled||!c?.enabled||s.qty>c.maxQty)fail('INVALID_REQUEST',422);selected.add(key);
   counts.set(g.id,(counts.get(g.id)??0)+s.qty);additions+=BigInt(c.priceDelta.amountMinor)*BigInt(s.qty);
   return {groupId:g.id,groupName:g.name,groupNameEn:g.nameEn,choiceId:c.id,choiceName:c.name,choiceNameEn:c.nameEn,qty:s.qty,priceDelta:c.priceDelta};
  });
  for(const g of o.groups)if(g.enabled){const n=counts.get(g.id)??0;if(n<g.minSelections||n>g.maxSelections)fail('INVALID_REQUEST',422);}
  const money=(n:bigint):Money=>{if(n<0n||n>maxMinor)fail('INVALID_PRICE',422);return {...p.unitPrice,amountMinor:String(n)};};
  const unit=BigInt(p.unitPrice.amountMinor)+additions;
  return {lineId:item.lineId,productId:p.productId,name:p.name,nameEn:p.nameEn,qty:item.qty,priceVersion:p.priceVersion,optionVersion:o.version,selections,allergyNote:item.allergyNote,productBasePrice:p.basePrice,productUnitPrice:p.unitPrice,optionsUnitPrice:money(additions),basePrice:money(BigInt(p.basePrice.amountMinor)+additions),unitPrice:money(unit),lineTotal:money(unit*BigInt(item.qty))};
 });
}
export async function productOptionsFor(db:pg.PoolClient,merchant:string,productIds:readonly string[]):Promise<Map<string,MobileProductOptions>>{
 const rows=(await db.query('SELECT p.product_id,v.id AS version,v.revision::text AS revision,v.note_enabled AS "noteEnabled",v.groups FROM product_online_options p JOIN product_option_versions v ON v.merchant_id=p.merchant_id AND v.product_id=p.product_id AND v.id=p.active_version_id WHERE p.merchant_id=$1 AND p.product_id=ANY($2::uuid[])',[merchant,productIds])).rows;
 return optionMap(productIds,rows);
}
function optionMap(productIds:readonly string[],rows:Record<string,unknown>[]){
 const options=new Map<string,MobileProductOptions>(productIds.map(id=>[id,{...noOptions,groups:[]}]));
 for(const {product_id,...value} of rows)options.set(String(product_id),MobileProductOptionsSchema.parse(value));
 return options;
}
export async function productOptionsAt(db:pg.PoolClient,merchant:string,pins:readonly {productId:string;version:string|null}[]):Promise<Map<string,MobileProductOptions>>{
 const ids=pins.map(p=>p.productId),versions=pins.map(p=>p.version);
 const rows=(await db.query('SELECT v.product_id,v.id AS version,v.revision::text AS revision,v.note_enabled AS "noteEnabled",v.groups FROM unnest($2::uuid[],$3::uuid[]) AS p(product_id,version) JOIN product_option_versions v ON v.merchant_id=$1 AND v.product_id=p.product_id AND v.id=p.version',[merchant,ids,versions])).rows;
 if(rows.length!==versions.filter(v=>v!==null).length)fail('QUOTE_CHANGED',409);
 return optionMap(ids,rows);
}
export async function productOptions(db:pg.PoolClient,merchant:string,productId:string):Promise<MobileProductOptions>{
 return (await productOptionsFor(db,merchant,[productId])).get(productId)!;
}
export async function publishProductOptions(db:pg.PoolClient,merchant:string,actor:string,role:string,productId:string,input:unknown){
 requireRole(role,true);const d=OnlineOptionsPublicationSchema.parse(input),digest=hash(JSON.stringify(d));await routingLock(db,merchant);
 if(!(await db.query('SELECT 1 FROM products WHERE merchant_id=$1 AND id=$2',[merchant,productId])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 const previous=(await db.query<{request_hash:string;version_id:string}>('SELECT request_hash,version_id FROM product_option_commands WHERE merchant_id=$1 AND product_id=$2 AND idempotency_key=$3',[merchant,productId,d.idempotencyKey])).rows[0];
 if(previous){
  if(previous.request_hash!==digest)fail('IDEMPOTENCY_CONFLICT');
  const row=(await db.query('SELECT id AS version,revision::text AS revision,note_enabled AS "noteEnabled",groups FROM product_option_versions WHERE merchant_id=$1 AND product_id=$2 AND id=$3',[merchant,productId,previous.version_id])).rows[0];return MobileProductOptionsSchema.parse(row);
 }
 const current=await productOptions(db,merchant,productId);if(current.revision!==d.expectedRevision)fail('QUOTE_CHANGED',409,{productId,reason:'OPTIONS_CHANGED'});
 const price=(await db.query<{id:string;currency:Money['currency'];decimals:Money['decimals']}>('SELECT v.id,v.currency,v.decimals FROM merchant_pricing p JOIN catalog_price_versions v ON v.merchant_id=p.merchant_id AND v.id=p.active_price_version_id WHERE p.merchant_id=$1',[merchant])).rows[0];
 if(!price||price.id!==d.priceVersion)fail('PRICE_VERSION_CHANGED');
 const version=randomUUID(),revision=String(BigInt(current.revision)+1n),result={version,revision,noteEnabled:d.noteEnabled,groups:d.groups};
 validateOptionGroups(result,price);
 await db.query('INSERT INTO product_option_versions(merchant_id,product_id,id,revision,currency,decimals,note_enabled,groups,price_version_id,configured_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[merchant,productId,version,revision,price.currency,price.decimals,d.noteEnabled,JSON.stringify(d.groups),price.id,actor]);
 if(current.version===null)await db.query('INSERT INTO product_online_options(merchant_id,product_id,active_version_id,revision) VALUES($1,$2,$3,$4)',[merchant,productId,version,revision]);
 else await db.query('UPDATE product_online_options SET active_version_id=$3,revision=$4 WHERE merchant_id=$1 AND product_id=$2',[merchant,productId,version,revision]);
 await db.query('INSERT INTO product_option_commands(merchant_id,product_id,idempotency_key,request_hash,version_id) VALUES($1,$2,$3,$4,$5)',[merchant,productId,d.idempotencyKey,digest,version]);
 await audit(db,merchant,actor,'product.online-options.publish',productId);return result;
}
