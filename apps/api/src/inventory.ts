import {createHash} from 'node:crypto';
import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';

const uuid=z.string().uuid();
const movement=z.object({
 productId:uuid,kind:z.enum(['RECEIVE','ADJUST']),delta:z.number().int().min(-100000).max(100000).refine(v=>v!==0),
 reason:z.string().trim().min(1).max(200),reference:z.string().trim().max(80).default(''),
 expectedStock:z.number().int().min(0),idempotencyKey:z.string().min(1).max(128)
}).strict().refine(v=>v.kind!=='RECEIVE'||v.delta>0);
export interface StockRow{productId:string;stock:number;reserved:number;available:number}
export interface StockMovement{id:string;productId:string;kind:'RECEIVE'|'ADJUST';delta:number;stockBefore:number;stockAfter:number;reason:string;reference:string;actor:string;createdAt:string}
const view=(r:{id:string;product_id:string;kind:'RECEIVE'|'ADJUST';delta:number;stock_before:number;stock_after:number;reason:string;reference:string;actor:string;created_at:Date}):StockMovement=>({id:r.id,productId:r.product_id,kind:r.kind,delta:r.delta,stockBefore:r.stock_before,stockAfter:r.stock_after,reason:r.reason,reference:r.reference,actor:r.actor,createdAt:r.created_at.toISOString()});
/** Owner/manager only. Quantity changes are optimistic (expectedStock), idempotent, never below reserved stock, and ledgered. */
export async function inventoryRequest(db:pg.PoolClient,merchant:string,actor:string,role:string,url:URL,method:string,input:unknown){
 requireRole(role);
 const path=url.pathname;
 if(path==='/api/inventory/stock'&&method==='GET'){
  if(url.search)fail('INVALID_REQUEST',422);
  const rows=(await db.query<{id:string;stock:number;reserved:number}>('SELECT id,stock,reserved FROM products WHERE merchant_id=$1 AND archived_at IS NULL ORDER BY sort_order,id',[merchant])).rows;
  return {products:rows.map((r):StockRow=>({productId:r.id,stock:r.stock,reserved:r.reserved,available:r.stock-r.reserved}))};
 }
 if(path==='/api/inventory/movements'&&method==='GET'){
  const keys=[...url.searchParams.keys()];if(keys.some(k=>!['productId','cursor'].includes(k))||new Set(keys).size!==keys.length)fail('INVALID_REQUEST',422);
  const product=url.searchParams.has('productId')?uuid.safeParse(url.searchParams.get('productId')):null,cursor=url.searchParams.has('cursor')?uuid.safeParse(url.searchParams.get('cursor')):null;
  if(product&&!product.success||cursor&&!cursor.success)fail('INVALID_REQUEST',422);
  const rows=(await db.query(`SELECT * FROM stock_movements WHERE merchant_id=$1 AND ($2::uuid IS NULL OR product_id=$2)
   AND ($3::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM stock_movements WHERE merchant_id=$1 AND id=$3)) ORDER BY created_at DESC,id DESC LIMIT 51`,[merchant,product?.data??null,cursor?.data??null])).rows;
  return {movements:rows.slice(0,50).map(view),nextCursor:rows.length>50?rows[49].id:null};
 }
 if(path==='/api/inventory/movements'&&method==='POST'){
  const data=movement.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
  const d=data.data,hash=createHash('sha256').update(JSON.stringify({p:d.productId,k:d.kind,d:d.delta,r:d.reason,f:d.reference,e:d.expectedStock})).digest('hex');
  const prior=(await db.query('SELECT * FROM stock_movements WHERE merchant_id=$1 AND idempotency_key=$2',[merchant,d.idempotencyKey])).rows[0];
  if(prior){if(prior.request_hash!==hash)fail('IDEMPOTENCY_CONFLICT');return {movement:view(prior),replayed:true};}
  const product=(await db.query<{stock:number;reserved:number}>('SELECT stock,reserved FROM products WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,d.productId])).rows[0];
  if(!product)fail('RESOURCE_NOT_FOUND',404);
  if(product.stock!==d.expectedStock)fail('STOCK_CHANGED');
  const after=product.stock+d.delta;
  if(after<0||after<product.reserved)fail('STOCK_BELOW_RESERVED',422);
  await db.query('UPDATE products SET stock=$3 WHERE merchant_id=$1 AND id=$2',[merchant,d.productId,after]);
  const row=(await db.query('INSERT INTO stock_movements(merchant_id,product_id,kind,delta,stock_before,stock_after,reason,reference,actor,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[merchant,d.productId,d.kind,d.delta,product.stock,after,d.reason,d.reference,actor,d.idempotencyKey,hash])).rows[0];
  await audit(db,merchant,actor,'inventory.'+d.kind.toLowerCase(),d.productId);
  return {movement:view(row),replayed:false};
 }
 fail('RESOURCE_NOT_FOUND',404);
}
