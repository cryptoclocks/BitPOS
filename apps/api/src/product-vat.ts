import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole,uuid} from './authority';
import {audit} from './db';

// M03b: per-product VAT exemption. Used by the cash register's tax-inclusive split (the line's amount stays in the total but carries no VAT).
// Owner decides; a sale keeps the flag it was rung up with (cash_sale_lines.vat_exempt), so changing it never rewrites a receipt.
const putBody=z.object({vatExempt:z.boolean(),expected:z.boolean()}).strict();
export async function productVat(db:pg.PoolClient,merchant:string,role:string):Promise<{products:{id:string;vatExempt:boolean}[]}>{
 requireRole(role);
 const rows=(await db.query<{id:string;vat_exempt:boolean}>('SELECT id,vat_exempt FROM products WHERE merchant_id=$1 AND archived_at IS NULL ORDER BY sort_order,id',[merchant])).rows;
 return {products:rows.map(r=>({id:r.id,vatExempt:r.vat_exempt}))};
}
export async function setProductVat(db:pg.PoolClient,merchant:string,actor:string,role:string,productId:string,input:unknown):Promise<{id:string;vatExempt:boolean}>{
 requireRole(role,true);
 const id=uuid.safeParse(productId);if(!id.success)fail('INVALID_REQUEST',422);
 const data=putBody.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
 const row=(await db.query<{vat_exempt:boolean}>('SELECT vat_exempt FROM products WHERE merchant_id=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE',[merchant,id.data])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);
 if(row.vat_exempt!==data.data.expected)fail('PRODUCT_CHANGED');
 if(row.vat_exempt===data.data.vatExempt)return {id:id.data,vatExempt:row.vat_exempt};
 await db.query('UPDATE products SET vat_exempt=$3 WHERE merchant_id=$1 AND id=$2',[merchant,id.data,data.data.vatExempt]);
 await audit(db,merchant,actor,'catalog.product.vat',id.data+' '+(data.data.vatExempt?'exempt':'taxable'));
 return {id:id.data,vatExempt:data.data.vatExempt};
}
