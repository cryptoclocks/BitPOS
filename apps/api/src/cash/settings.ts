import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from '../authority';
import {audit} from '../db';

export interface CashSettings{enabled:boolean;currency:string;decimals:number;vatMode:'none'|'inclusive';vatBps:number;sellerName:string;sellerTaxId:string;sellerBranch:string;sellerAddress:string;receiptPrefix:string;staffMaxDiscountBps:number}
export const DEFAULTS:CashSettings={enabled:false,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'R',staffMaxDiscountBps:0};
const save=z.object({enabled:z.boolean(),currency:z.string().regex(/^[A-Z]{3}$/),decimals:z.number().int().min(0).max(4),vatMode:z.enum(['none','inclusive']),vatBps:z.number().int().min(0).max(3000),
 sellerName:z.string().trim().max(120),sellerTaxId:z.string().regex(/^([0-9]{13})?$/),sellerBranch:z.string().regex(/^[0-9]{5}$/),sellerAddress:z.string().trim().max(300),
 receiptPrefix:z.string().regex(/^[A-Z0-9]{0,6}$/),staffMaxDiscountBps:z.number().int().min(0).max(9999)}).strict();
const prices=z.object({set:z.array(z.object({productId:z.string().uuid(),priceMinor:z.string().regex(/^[1-9][0-9]{0,11}$/)}).strict()).max(200).default([]),clear:z.array(z.string().uuid()).max(200).default([])}).strict()
 .refine(v=>new Set([...v.set.map(s=>s.productId),...v.clear]).size===v.set.length+v.clear.length);
type Row={enabled:boolean;currency:string;decimals:number;vat_mode:'none'|'inclusive';vat_bps:number;seller_name:string;seller_tax_id:string;seller_branch:string;seller_address:string;receipt_prefix:string;staff_max_discount_bps:number};
const view=(r:Row):CashSettings=>({enabled:r.enabled,currency:r.currency,decimals:r.decimals,vatMode:r.vat_mode,vatBps:r.vat_bps,sellerName:r.seller_name,sellerTaxId:r.seller_tax_id,sellerBranch:r.seller_branch,sellerAddress:r.seller_address,receiptPrefix:r.receipt_prefix,staffMaxDiscountBps:r.staff_max_discount_bps});
const staffUp=(role:string)=>{if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);};

export async function loadSettings(db:pg.PoolClient,merchant:string,lock=false):Promise<CashSettings>{
 const r=(await db.query<Row>(`SELECT * FROM cash_settings WHERE merchant_id=$1${lock?' FOR SHARE':''}`,[merchant])).rows[0];
 return r?view(r):DEFAULTS;
}
export async function getSettings(db:pg.PoolClient,merchant:string,role:string){staffUp(role);return {settings:await loadSettings(db,merchant)};}
/** Owner only. A tax invoice needs a seller name and a 13-digit tax id; currency cannot change once prices or sales exist (no conversion is ever done). */
export async function saveSettings(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 requireRole(role,true);
 const p=save.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);const d=p.data;
 if(d.vatMode==='inclusive'&&(!d.sellerName||d.sellerTaxId.length!==13))fail('INVALID_REQUEST',422);
 const cur=await loadSettings(db,merchant,true);
 if((d.currency!==cur.currency||d.decimals!==cur.decimals)&&((await db.query('SELECT 1 FROM cash_prices WHERE merchant_id=$1 LIMIT 1',[merchant])).rowCount||(await db.query('SELECT 1 FROM cash_sales WHERE merchant_id=$1 LIMIT 1',[merchant])).rowCount))fail('INVALID_REQUEST',409);
 await db.query(`INSERT INTO cash_settings(merchant_id,enabled,currency,decimals,vat_mode,vat_bps,seller_name,seller_tax_id,seller_branch,seller_address,receipt_prefix,staff_max_discount_bps,updated_by)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(merchant_id) DO UPDATE SET enabled=excluded.enabled,currency=excluded.currency,decimals=excluded.decimals,vat_mode=excluded.vat_mode,vat_bps=excluded.vat_bps,
  seller_name=excluded.seller_name,seller_tax_id=excluded.seller_tax_id,seller_branch=excluded.seller_branch,seller_address=excluded.seller_address,receipt_prefix=excluded.receipt_prefix,staff_max_discount_bps=excluded.staff_max_discount_bps,updated_by=excluded.updated_by,updated_at=clock_timestamp()`,
  [merchant,d.enabled,d.currency,d.decimals,d.vatMode,d.vatBps,d.sellerName,d.sellerTaxId,d.sellerBranch,d.sellerAddress,d.receiptPrefix,d.staffMaxDiscountBps,actor]);
 await audit(db,merchant,actor,'cash.settings',d.enabled?'enabled':'disabled');
 return {settings:d};
}
export async function getPrices(db:pg.PoolClient,merchant:string,role:string){
 staffUp(role);
 const rows=(await db.query<{product_id:string;price_minor:string}>('SELECT product_id,price_minor::text FROM cash_prices WHERE merchant_id=$1 ORDER BY product_id',[merchant])).rows;
 const s=await loadSettings(db,merchant);
 return {currency:s.currency,decimals:s.decimals,prices:rows.map(r=>({productId:r.product_id,priceMinor:r.price_minor}))};
}
export async function putPrices(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 requireRole(role);
 const p=prices.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);
 const setIds=p.data.set.map(s=>s.productId);
 if(setIds.length&&(await db.query('SELECT count(*)::int n FROM products WHERE merchant_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL',[merchant,setIds])).rows[0].n!==setIds.length)fail('RESOURCE_NOT_FOUND',404);
 for(const s of [...p.data.set].sort((a,b)=>a.productId.localeCompare(b.productId)))
  await db.query(`INSERT INTO cash_prices(merchant_id,product_id,price_minor,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(merchant_id,product_id) DO UPDATE SET price_minor=excluded.price_minor,updated_by=excluded.updated_by,updated_at=clock_timestamp()`,[merchant,s.productId,s.priceMinor,actor]);
 if(p.data.clear.length)await db.query('DELETE FROM cash_prices WHERE merchant_id=$1 AND product_id=ANY($2::uuid[])',[merchant,p.data.clear]);
 await audit(db,merchant,actor,'cash.prices',`set:${p.data.set.length},clear:${p.data.clear.length}`);
 return {set:p.data.set.length,cleared:p.data.clear.length};
}
