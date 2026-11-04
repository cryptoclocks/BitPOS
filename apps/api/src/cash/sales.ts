import {createHash} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from '../authority';
import {audit} from '../db';
import {assertSellable} from '../catalog-availability';
import {demoCashState} from '../demo-money';
import {CashPriceError,priceCashSale,type CashTotals,type Discount} from './pricing';
import {loadSettings,type CashSettings} from './settings';

const integer=z.string().regex(/^(0|[1-9][0-9]{0,17})$/);
const cartLine=z.object({productId:z.string().uuid(),qty:z.number().int().min(1).max(100),sweetness:z.union([z.literal(0),z.literal(25),z.literal(50),z.literal(75),z.literal(100)]).optional(),addonIds:z.array(z.string().uuid()).max(10).optional()}).strict();
/** One cart line is a product with one set of options; the same drink with different options is a different line. */
export const lineKey=(i:{productId:string;sweetness?:number;addonIds?:string[]})=>`${i.productId}|${i.sweetness??''}|${[...new Set(i.addonIds??[])].sort().join(',')}`;
const discount=z.discriminatedUnion('kind',[z.object({kind:z.literal('percent'),bps:z.number().int().min(1).max(9999)}).strict(),z.object({kind:z.literal('amount'),minor:integer}).strict()]).nullable().default(null);
export const cart=z.array(cartLine).min(1).max(50).refine(items=>new Set(items.map(lineKey)).size===items.length).refine(items=>items.every(i=>new Set(i.addonIds??[]).size===(i.addonIds??[]).length));
const quoteBody=z.object({items:cart,discount}).strict();
const saleBody=z.object({idempotencyKey:z.string().min(1).max(128),items:cart,discount,tenderMinor:integer}).strict();
const voidBody=z.object({reason:z.string().trim().min(1).max(200),restock:z.boolean()}).strict();
const staffUp=(role:string)=>{if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);};

export interface CashSaleView{id:string;seq:string;receiptNo:string;status:'PAID'|'VOIDED';currency:{code:string;decimals:number};subtotalMinor:string;discountMinor:string;totalMinor:string;netMinor:string;vatMinor:string;vatMode:'none'|'inclusive';vatBps:number;tenderMinor:string;changeMinor:string;cashier:string;createdAt:string;
 void:{at:string;by:string;reason:string;restocked:boolean}|null;seller:Record<string,unknown>;lines:{lineNo:number;productId:string;name:string;nameEn:string;qty:number;unit:string;baseMinor:string|null;unitMinor:string;lineTotalMinor:string;sweetness:number|null;vatExempt:boolean;addons:{id:string;label:string;labelEn:string;priceMinor:string}[]}[]}
type SaleRow={id:string;seq:string;receipt_no:string;status:'PAID'|'VOIDED';currency_code:string;decimals:number;subtotal_minor:string;discount_minor:string;total_minor:string;net_minor:string;vat_minor:string;vat_mode:'none'|'inclusive';vat_bps:number;tender_minor:string;change_minor:string;cashier:string;created_at:Date;voided_at:Date|null;voided_by:string|null;void_reason:string|null;void_restocked:boolean|null;seller:Record<string,unknown>};
const COLS='id,seq::text,receipt_no,status,currency_code,decimals,subtotal_minor::text,discount_minor::text,total_minor::text,net_minor::text,vat_minor::text,vat_mode,vat_bps,tender_minor::text,change_minor::text,cashier,created_at,voided_at,voided_by,void_reason,void_restocked,seller';
const view=(r:SaleRow,lines:CashSaleView['lines']):CashSaleView=>({id:r.id,seq:r.seq,receiptNo:r.receipt_no,status:r.status,currency:{code:r.currency_code,decimals:r.decimals},subtotalMinor:r.subtotal_minor,discountMinor:r.discount_minor,totalMinor:r.total_minor,netMinor:r.net_minor,vatMinor:r.vat_minor,vatMode:r.vat_mode,vatBps:r.vat_bps,tenderMinor:r.tender_minor,changeMinor:r.change_minor,cashier:r.cashier,createdAt:r.created_at.toISOString(),
 void:r.voided_at?{at:r.voided_at.toISOString(),by:r.voided_by!,reason:r.void_reason!,restocked:r.void_restocked!}:null,seller:r.seller,lines});
async function linesOf(db:pg.PoolClient,merchant:string,id:string){
 return (await db.query<{line_no:number;product_id:string;name:string;name_en:string;qty:number;unit:string;base_minor:string|null;unit_minor:string;line_total_minor:string;sweetness:number|null;vat_exempt:boolean;addons:CashSaleView['lines'][number]['addons']}>('SELECT line_no,product_id,name,name_en,qty,unit,base_minor::text,unit_minor::text,line_total_minor::text,sweetness,vat_exempt,addons FROM cash_sale_lines WHERE merchant_id=$1 AND sale_id=$2 ORDER BY line_no',[merchant,id])).rows
  .map(l=>({lineNo:l.line_no,productId:l.product_id,name:l.name,nameEn:l.name_en,qty:l.qty,unit:l.unit,baseMinor:l.base_minor,unitMinor:l.unit_minor,lineTotalMinor:l.line_total_minor,sweetness:l.sweetness,vatExempt:l.vat_exempt,addons:l.addons}));
}
const totalsView=(t:CashTotals)=>({exemptMinor:String(t.exempt),subtotalMinor:String(t.subtotal),discountMinor:String(t.discount),totalMinor:String(t.total),netMinor:String(t.net),vatMinor:String(t.vat),tenderMinor:t.tender===null?null:String(t.tender),changeMinor:t.change===null?null:String(t.change)});
function priceOrFail(lines:Parameters<typeof priceCashSale>[0],d:Discount,s:CashSettings,tender?:bigint){
 try{return priceCashSale(lines,d,{mode:s.vatMode,bps:s.vatBps},tender);}
 catch(e){if(e instanceof CashPriceError)fail(e.code==='TENDER_TOO_LOW'||e.code==='BAD_AMOUNT'||e.code==='DISCOUNT_TOO_LARGE'?'INVALID_PRICE':'INVALID_REQUEST',422);throw e;}
}
/** Staff may only give the discount the owner allowed; owner and manager may give any discount below 100%. */
function checkDiscountRight(role:string,d:Discount,subtotal:bigint,s:CashSettings){
 if(!d||role==='owner'||role==='manager')return;
 const bps=d.kind==='percent'?BigInt(d.bps):(BigInt(d.minor)*10000n+subtotal-1n)/subtotal; // round up: never understate how large the discount is
 if(bps>BigInt(s.staffMaxDiscountBps))fail('ROLE_REQUIRED',403);
}
type Prod={id:string;name:string;name_en:string;stock:number;reserved:number;price_minor:string|null;unit:string|null;sweetness_enabled:boolean|null;vat_exempt:boolean};
type Addon={id:string;label:string;labelEn:string;priceMinor:string};
async function lockProducts(db:pg.PoolClient,merchant:string,ids:string[]){
 const rows=(await db.query<Prod>(`SELECT p.id,p.name,p.name_en,p.stock,p.reserved,c.price_minor::text,c.unit,c.sweetness_enabled,p.vat_exempt FROM products p LEFT JOIN cash_prices c ON c.merchant_id=p.merchant_id AND c.product_id=p.id
  WHERE p.merchant_id=$1 AND p.id=ANY($2::uuid[]) AND p.archived_at IS NULL ORDER BY p.id FOR UPDATE OF p`,[merchant,ids])).rows;
 if(rows.length!==ids.length)fail('RESOURCE_NOT_FOUND',404);
 await assertSellable(db,merchant,ids);
 return new Map(rows.map(r=>[r.id,r]));
}
async function loadAddons(db:pg.PoolClient,merchant:string,ids:string[]){
 const rows=(await db.query<{product_id:string;id:string;label:string;label_en:string;price_minor:string}>('SELECT product_id,id,label,label_en,price_minor::text FROM cash_addons WHERE merchant_id=$1 AND product_id=ANY($2::uuid[])',[merchant,ids])).rows;
 return new Map(rows.map(r=>[r.id,{product:r.product_id,addon:{id:r.id,label:r.label,labelEn:r.label_en,priceMinor:r.price_minor}}]));
}
interface PricedItem{productId:string;qty:number;unitMinor:bigint;baseMinor:bigint;unit:string;sweetness:number|null;vatExempt:boolean;addons:Addon[]}
/** Unit price = the product's cash price plus the chosen paid add-ons, all read from the server's own tables. */
async function priced(db:pg.PoolClient,merchant:string,items:{productId:string;qty:number;sweetness?:number;addonIds?:string[]}[],byId:Map<string,Prod>):Promise<PricedItem[]>{
 const addons=await loadAddons(db,merchant,[...byId.keys()]);
 return items.map(i=>{
  const p=byId.get(i.productId)!;if(p.price_minor===null)fail('INVALID_PRICE',422);
  if(i.sweetness!==undefined&&!p.sweetness_enabled)fail('INVALID_REQUEST',422);
  const chosen=(i.addonIds??[]).map(id=>{const a=addons.get(id);if(!a||a.product!==i.productId)fail('RESOURCE_NOT_FOUND',404);return a.addon;});
  const base=BigInt(p.price_minor),unit=base+chosen.reduce((n,a)=>n+BigInt(a.priceMinor),0n);
  return {productId:i.productId,qty:i.qty,unitMinor:unit,baseMinor:base,unit:p.unit??'',sweetness:i.sweetness??null,vatExempt:p.vat_exempt,addons:chosen};
 });
}
function ready(s:CashSettings){if(!s.enabled)fail('CONFIGURATION_REQUIRED',409);}

/** Server-side totals for the screen. Nothing is stored; the same function prices the real sale. */
export async function quoteCashSale(db:pg.PoolClient,merchant:string,role:string,input:unknown){
 staffUp(role);
 const p=quoteBody.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);
 const s=await loadSettings(db,merchant);ready(s);
 const byId=await lockProducts(db,merchant,p.data.items.map(i=>i.productId));
 const lines=await priced(db,merchant,p.data.items,byId),t=priceOrFail(lines,p.data.discount,s);
 checkDiscountRight(role,p.data.discount,t.subtotal,s);
 return {currency:{code:s.currency,decimals:s.decimals},vatMode:s.vatMode,vatBps:s.vatBps,...totalsView(t),lines:lines.map(l=>({productId:l.productId,qty:l.qty,unitMinor:String(l.unitMinor),sweetness:l.sweetness,vatExempt:l.vatExempt,addons:l.addons}))};
}

/** One transaction: price on the server, take stock through the ledger, number the receipt without gaps, store an immutable snapshot. */
export async function createCashSale(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 staffUp(role);
 const p=saleBody.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);
 const d=p.data,items=[...d.items].sort((a,b)=>lineKey(a).localeCompare(lineKey(b)));
 const hash=createHash('sha256').update(JSON.stringify({i:items.map(i=>({...i,addonIds:[...(i.addonIds??[])].sort()})),d:d.discount,t:d.tenderMinor})).digest('hex');
 await db.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))',['shift-close:'+merchant]); // a running shift close waits for this sale and vice versa
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cash-sale:'+merchant]);
 const prior=(await db.query<SaleRow&{request_hash:string}>(`SELECT ${COLS},request_hash FROM cash_sales WHERE merchant_id=$1 AND idempotency_key=$2`,[merchant,d.idempotencyKey])).rows[0];
 if(prior){if(prior.request_hash!==hash)fail('IDEMPOTENCY_CONFLICT');return {sale:view(prior,await linesOf(db,merchant,prior.id)),replayed:true};}
 const s=await loadSettings(db,merchant,true);ready(s);
 const byId=await lockProducts(db,merchant,[...new Set(items.map(i=>i.productId))].sort());
 const need=new Map<string,number>();for(const i of items)need.set(i.productId,(need.get(i.productId)??0)+i.qty);
 for(const [id,qty] of need){const x=byId.get(id)!;if(x.stock-x.reserved<qty)fail('STOCK_UNAVAILABLE');}
 const lines=await priced(db,merchant,d.items,byId),t=priceOrFail(lines,d.discount,s,BigInt(d.tenderMinor)); // receipt lines keep the order the cashier rang them up
 checkDiscountRight(role,d.discount,t.subtotal,s);
 const seq=(await db.query<{v:string}>(`INSERT INTO cash_receipt_counters(merchant_id,series,last_value) VALUES($1,'main',1) ON CONFLICT(merchant_id,series) DO UPDATE SET last_value=cash_receipt_counters.last_value+1 RETURNING last_value::text v`,[merchant])).rows[0].v;
 const receiptNo=`${s.receiptPrefix}${seq.padStart(6,'0')}`;
 const seller={name:s.sellerName,nameEn:s.sellerNameEn,taxId:s.sellerTaxId,branch:s.sellerBranch,address:s.sellerAddress,addressEn:s.sellerAddressEn};
 const row=(await db.query<SaleRow>(`INSERT INTO cash_sales(merchant_id,seq,receipt_no,currency_code,decimals,subtotal_minor,discount_minor,total_minor,net_minor,vat_minor,vat_mode,vat_bps,tender_minor,change_minor,cashier,cashier_role,seller,idempotency_key,request_hash)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING ${COLS}`,
  [merchant,seq,receiptNo,s.currency,s.decimals,String(t.subtotal),String(t.discount),String(t.total),String(t.net),String(t.vat),s.vatMode,s.vatBps,String(t.tender),String(t.change),actor,role,JSON.stringify(seller),d.idempotencyKey,hash])).rows[0];
 const running=new Map([...byId].map(([id,x])=>[id,x.stock]));
 for(const [i,l] of lines.entries()){
  const x=byId.get(l.productId)!,lineNo=i+1,before=running.get(l.productId)!,after=before-l.qty;running.set(l.productId,after);
  await db.query('INSERT INTO cash_sale_lines(merchant_id,sale_id,line_no,product_id,name,name_en,qty,unit,base_minor,unit_minor,line_total_minor,sweetness,addons,vat_exempt) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[merchant,row.id,lineNo,l.productId,x.name,x.name_en,l.qty,l.unit,String(l.baseMinor),String(l.unitMinor),String(l.unitMinor*BigInt(l.qty)),l.sweetness,JSON.stringify(l.addons),l.vatExempt]);
  await db.query('UPDATE products SET stock=$3 WHERE merchant_id=$1 AND id=$2',[merchant,l.productId,after]);
  await db.query(`INSERT INTO stock_movements(merchant_id,product_id,kind,delta,stock_before,stock_after,reason,reference,actor,idempotency_key,request_hash) VALUES($1,$2,'CASH_SALE',$3,$4,$5,'cash sale',$6,$7,$8,$9)`,
   [merchant,l.productId,-l.qty,before,after,receiptNo,actor,`cash:${row.id}:${lineNo}:sale`,createHash('sha256').update(`${row.id}:${lineNo}:${l.qty}`).digest('hex')]);
 }
 await audit(db,merchant,actor,'cash.sale',row.id);
 return {sale:view(row,await linesOf(db,merchant,row.id)),replayed:false};
}

export async function listCashSales(db:pg.PoolClient,merchant:string,role:string){
 staffUp(role);
 const rows=(await db.query<SaleRow>(`SELECT ${COLS} FROM cash_sales WHERE merchant_id=$1 ORDER BY seq DESC LIMIT 100`,[merchant])).rows;
 return {sales:rows.map(r=>view(r,[]))};
}
export async function getCashSale(db:pg.PoolClient,merchant:string,role:string,id:unknown){
 staffUp(role);
 const u=z.string().uuid().safeParse(id);if(!u.success)fail('INVALID_REQUEST',422);
 const r=(await db.query<SaleRow>(`SELECT ${COLS} FROM cash_sales WHERE merchant_id=$1 AND id=$2`,[merchant,u.data])).rows[0];
 if(!r)fail('RESOURCE_NOT_FOUND',404);
 return {sale:view(r,await linesOf(db,merchant,r.id)),demo:await demoCashState(db,merchant,role,r.id,r.status)};
}
/** Owner/manager only, with a reason. Stock goes back only when the person says the goods are sellable again. A receipt number is never reused. */
export async function voidCashSale(db:pg.PoolClient,merchant:string,actor:string,role:string,id:unknown,input:unknown){
 requireRole(role);
 const u=z.string().uuid().safeParse(id),p=voidBody.safeParse(input);if(!u.success||!p.success)fail('INVALID_REQUEST',422);
 await db.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))',['shift-close:'+merchant]);
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cash-drawer:'+merchant]); // a void lowers expected cash: serialise with cash-out checks
 const cur=(await db.query<SaleRow>(`SELECT ${COLS} FROM cash_sales WHERE merchant_id=$1 AND id=$2 FOR UPDATE`,[merchant,u.data])).rows[0];
 if(!cur)fail('RESOURCE_NOT_FOUND',404);
 if(cur.status!=='PAID')fail('INVALID_REQUEST',409);
 const lines=await linesOf(db,merchant,cur.id);
 if(p.data.restock){
  for(const l of [...lines].sort((a,b)=>a.productId.localeCompare(b.productId))){
   const x=(await db.query<{stock:number}>('SELECT stock FROM products WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,l.productId])).rows[0];
   if(!x)continue;const after=x.stock+l.qty;
   await db.query('UPDATE products SET stock=$3 WHERE merchant_id=$1 AND id=$2',[merchant,l.productId,after]);
   await db.query(`INSERT INTO stock_movements(merchant_id,product_id,kind,delta,stock_before,stock_after,reason,reference,actor,idempotency_key,request_hash) VALUES($1,$2,'CASH_VOID_RETURN',$3,$4,$5,'cash sale voided',$6,$7,$8,$9)`,
    [merchant,l.productId,l.qty,x.stock,after,cur.receipt_no,actor,`cash:${cur.id}:${l.lineNo}:void`,createHash('sha256').update(`${cur.id}:${l.lineNo}:void`).digest('hex')]);
  }
 }
 const row=(await db.query<SaleRow>(`UPDATE cash_sales SET status='VOIDED',voided_at=clock_timestamp(),voided_by=$3,void_reason=$4,void_restocked=$5 WHERE merchant_id=$1 AND id=$2 RETURNING ${COLS}`,[merchant,cur.id,actor,p.data.reason,p.data.restock])).rows[0];
 await audit(db,merchant,actor,'cash.void',cur.id);
 return {sale:view(row,lines)};
}
