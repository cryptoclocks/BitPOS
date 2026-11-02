import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from '../authority';
import {audit} from '../db';
import {applyChannelStock} from './stock';

const source=z.enum(['grabfood','lineman']);
const save=z.object({source,externalItemId:z.string().min(1).max(200),productId:z.string().uuid().nullable()}).strict();

/**
 * Which BitPOS product a platform item id means. Only an owner-confirmed row in channel_item_map, or a platform id that already
 * equals one of this merchant's product ids, counts. Item names are never matched.
 */
export async function resolveMappedProduct(db:pg.PoolClient,merchant:string,src:'grabfood'|'lineman',externalItemId:string):Promise<string|null>{
 const m=(await db.query<{product_id:string}>('SELECT product_id FROM channel_item_map WHERE merchant_id=$1 AND source=$2 AND external_item_id=$3',[merchant,src,externalItemId])).rows[0];
 if(m)return m.product_id;
 if(!z.string().uuid().safeParse(externalItemId).success)return null;
 return (await db.query('SELECT 1 FROM products WHERE merchant_id=$1 AND id=$2',[merchant,externalItemId])).rowCount?externalItemId:null;
}

/** Items seen on received orders that no product is mapped to yet, plus the mappings the owner has chosen. */
export async function listItemMap(db:pg.PoolClient,merchant:string,role:string,src:unknown){
 if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);
 const s=source.safeParse(src);if(!s.success)fail('INVALID_REQUEST',422);
 const unmapped=(await db.query(`SELECT l.external_item_id,count(*)::int AS lines,sum(l.qty)::int AS qty,max(o.order_time) AS last_seen,
   (array_agg(l.unit_minor ORDER BY o.order_time DESC))[1]::text AS last_unit_minor,(array_agg(o.currency_code ORDER BY o.order_time DESC))[1] AS currency,(array_agg(o.currency_exponent ORDER BY o.order_time DESC))[1] AS decimals
   FROM channel_order_lines l JOIN channel_orders o ON o.merchant_id=l.merchant_id AND o.id=l.order_id
   WHERE l.merchant_id=$1 AND o.source=$2 AND l.mapped_product_id IS NULL GROUP BY l.external_item_id ORDER BY max(o.order_time) DESC LIMIT 200`,[merchant,s.data])).rows;
 const mapped=(await db.query('SELECT external_item_id,product_id FROM channel_item_map WHERE merchant_id=$1 AND source=$2 ORDER BY external_item_id',[merchant,s.data])).rows;
 return {source:s.data,
  unmapped:unmapped.map(r=>({externalItemId:r.external_item_id,lines:r.lines,qty:r.qty,lastSeen:r.last_seen,lastUnit:{currency:r.currency,decimals:r.decimals,amountMinor:r.last_unit_minor}})),
  mapped:mapped.map(r=>({externalItemId:r.external_item_id,productId:r.product_id}))};
}

/**
 * Owner/manager picks the product for one platform item (or clears it with productId=null). Setting fills lines that are still
 * unmapped; clearing un-maps lines only on orders that are still open, so finished orders keep what was true when they closed.
 */
export async function saveItemMap(db:pg.PoolClient,merchant:string,actor:string,role:string,body:unknown){
 requireRole(role);
 const p=save.safeParse(body);if(!p.success)fail('INVALID_REQUEST',422);const d=p.data;
 if(d.productId===null){
  await db.query('DELETE FROM channel_item_map WHERE merchant_id=$1 AND source=$2 AND external_item_id=$3',[merchant,d.source,d.externalItemId]);
  const r=await db.query(`UPDATE channel_order_lines l SET mapped_product_id=NULL FROM channel_orders o
   WHERE l.merchant_id=$1 AND l.external_item_id=$3 AND o.merchant_id=l.merchant_id AND o.id=l.order_id AND o.source=$2 AND o.status NOT IN ('completed','rejected','cancelled','expired')`,[merchant,d.source,d.externalItemId]);
  await audit(db,merchant,actor,'channel.item_map.clear',`${d.source}:${d.externalItemId}`);
  return {source:d.source,externalItemId:d.externalItemId,productId:null,updatedLines:r.rowCount??0};
 }
 if(!(await db.query('SELECT 1 FROM products WHERE merchant_id=$1 AND id=$2',[merchant,d.productId])).rowCount)fail('RESOURCE_NOT_FOUND',404);
 await db.query(`INSERT INTO channel_item_map(merchant_id,source,external_item_id,product_id,updated_by) VALUES($1,$2,$3,$4,$5)
  ON CONFLICT(merchant_id,source,external_item_id) DO UPDATE SET product_id=excluded.product_id,updated_by=excluded.updated_by,updated_at=clock_timestamp()`,[merchant,d.source,d.externalItemId,d.productId,actor]);
 const r=await db.query(`UPDATE channel_order_lines l SET mapped_product_id=$4 FROM channel_orders o
  WHERE l.merchant_id=$1 AND l.external_item_id=$3 AND l.mapped_product_id IS NULL AND o.merchant_id=l.merchant_id AND o.id=l.order_id AND o.source=$2 RETURNING l.order_id`,[merchant,d.source,d.externalItemId,d.productId]);
 // An order accepted before its items were mapped takes its stock now.
 for(const id of [...new Set(r.rows.map(x=>x.order_id as string))].sort())await applyChannelStock(db,merchant,id);
 await audit(db,merchant,actor,'channel.item_map.set',`${d.source}:${d.externalItemId}`);
 return {source:d.source,externalItemId:d.externalItemId,productId:d.productId,updatedLines:r.rowCount??0};
}
