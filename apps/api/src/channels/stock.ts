import {createHash} from 'node:crypto';
import type pg from 'pg';
import type {ChannelOrderStatus} from '../../../../packages/contracts/src/order-channels';

/** Orders the shop has accepted and is therefore making; stock is taken once, when an order first reaches one of these. */
const COMMITTED:ChannelOrderStatus[]=['accepted','preparing','ready','handed_over','completed'];

/**
 * Take stock for the mapped lines of one order through the stock ledger. Safe to call any number of times: each line is taken at most
 * once (primary key + ledger idempotency key), so duplicate polls, retries and a mapping chosen after acceptance all converge.
 * Unmapped lines are left alone. If the shelf holds less than the order needs, only what exists is taken and the gap is recorded.
 * The caller holds the order row lock.
 */
export async function applyChannelStock(db:pg.PoolClient,merchant:string,orderId:string):Promise<number>{
 const order=(await db.query<{status:ChannelOrderStatus;source:string;external_order_id:string}>('SELECT status,source,external_order_id FROM channel_orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,orderId])).rows[0];
 if(!order||!COMMITTED.includes(order.status))return 0;
 const lines=(await db.query<{line_no:number;qty:number;mapped_product_id:string}>(`SELECT l.line_no,l.qty,l.mapped_product_id FROM channel_order_lines l
  WHERE l.merchant_id=$1 AND l.order_id=$2 AND l.mapped_product_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM channel_stock_effects e WHERE e.merchant_id=l.merchant_id AND e.order_id=l.order_id AND e.line_no=l.line_no) ORDER BY l.line_no`,[merchant,orderId])).rows;
 let taken=0;
 for(const line of lines){
  const product=(await db.query<{stock:number;reserved:number}>('SELECT stock,reserved FROM products WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,line.mapped_product_id])).rows[0];
  if(!product)continue;
  const applied=Math.min(line.qty,Math.max(0,product.stock-product.reserved));
  let movement:string|null=null;
  if(applied>0){
   const key=`channel:${orderId}:${line.line_no}:sale`,after=product.stock-applied;
   const hash=createHash('sha256').update(JSON.stringify({o:orderId,l:line.line_no,p:line.mapped_product_id,q:applied})).digest('hex');
   await db.query('UPDATE products SET stock=$3 WHERE merchant_id=$1 AND id=$2',[merchant,line.mapped_product_id,after]);
   movement=(await db.query<{id:string}>(`INSERT INTO stock_movements(merchant_id,product_id,kind,delta,stock_before,stock_after,reason,reference,actor,idempotency_key,request_hash)
    VALUES($1,$2,'CHANNEL_SALE',$3,$4,$5,$6,$7,'system:channel',$8,$9) RETURNING id`,[merchant,line.mapped_product_id,-applied,product.stock,after,`${order.source} order`,order.external_order_id.slice(0,80),key,hash])).rows[0].id;
   taken+=applied;
  }
  await db.query('INSERT INTO channel_stock_effects(merchant_id,order_id,line_no,product_id,qty_requested,qty_applied,movement_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[merchant,orderId,line.line_no,line.mapped_product_id,line.qty,applied,movement]);
 }
 return taken;
}
