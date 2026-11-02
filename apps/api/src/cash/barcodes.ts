import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from '../authority';
import {audit} from '../db';

const code=z.string().trim().regex(/^[0-9A-Za-z-]{4,32}$/);
const put=z.object({productId:z.string().uuid(),barcode:code}).strict();
const del=z.object({barcode:code}).strict();
const staffUp=(role:string)=>{if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);};

/** Scanner input: exact match only. A code that is not registered is reported as not found; nothing is ever guessed from a product name. */
export async function lookupBarcode(db:pg.PoolClient,merchant:string,role:string,input:unknown){
 staffUp(role);
 const c=code.safeParse(input);if(!c.success)fail('INVALID_REQUEST',422);
 const r=(await db.query<{product_id:string}>('SELECT b.product_id FROM product_barcodes b JOIN products p ON p.merchant_id=b.merchant_id AND p.id=b.product_id WHERE b.merchant_id=$1 AND b.barcode=$2 AND p.archived_at IS NULL',[merchant,c.data])).rows[0];
 if(!r)fail('RESOURCE_NOT_FOUND',404);
 return {productId:r.product_id,barcode:c.data};
}
export async function listBarcodes(db:pg.PoolClient,merchant:string,role:string,productId:unknown){
 requireRole(role);
 const p=productId==null?null:z.string().uuid().safeParse(productId);if(p&&!p.success)fail('INVALID_REQUEST',422);
 const rows=(await db.query<{barcode:string;product_id:string}>('SELECT barcode,product_id FROM product_barcodes WHERE merchant_id=$1 AND ($2::uuid IS NULL OR product_id=$2) ORDER BY barcode LIMIT 2000',[merchant,p?.data??null])).rows;
 return {barcodes:rows.map(r=>({barcode:r.barcode,productId:r.product_id}))};
}
export async function addBarcode(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 requireRole(role);
 const d=put.safeParse(input);if(!d.success)fail('INVALID_REQUEST',422);
 if(!(await db.query('SELECT 1 FROM products WHERE merchant_id=$1 AND id=$2 AND archived_at IS NULL',[merchant,d.data.productId])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 // Insert-or-detect in one statement: the app role may insert but not lock-for-update here, and a lost race simply reads back the winner.
 const inserted=await db.query('INSERT INTO product_barcodes(merchant_id,barcode,product_id,created_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[merchant,d.data.barcode,d.data.productId,actor]);
 if(!inserted.rowCount){
  const existing=(await db.query<{product_id:string}>('SELECT product_id FROM product_barcodes WHERE merchant_id=$1 AND barcode=$2',[merchant,d.data.barcode])).rows[0];
  if(existing?.product_id===d.data.productId)return {...d.data,replayed:true};
  fail('INVALID_REQUEST',409);
 }
 await audit(db,merchant,actor,'barcode.add',`${d.data.productId}:${d.data.barcode}`);
 return {...d.data,replayed:false};
}
export async function removeBarcode(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 requireRole(role);
 const d=del.safeParse(input);if(!d.success)fail('INVALID_REQUEST',422);
 const r=await db.query('DELETE FROM product_barcodes WHERE merchant_id=$1 AND barcode=$2',[merchant,d.data.barcode]);
 if(!r.rowCount)fail('RESOURCE_NOT_FOUND',404);
 await audit(db,merchant,actor,'barcode.remove',d.data.barcode);
 return {barcode:d.data.barcode};
}
