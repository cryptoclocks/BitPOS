import type pg from 'pg';
import type {OrderRow} from './types';
import {fail} from './authority';
/** Only call after cryptographically verifying an order-specific signature. */
export async function associateProvenWallet(db:pg.PoolClient,o:OrderRow,address:string){
 if(o.payer&&o.payer!==address)fail('WALLET_CONFLICT',409);
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[o.merchant_id+':wallet:'+address]);
 const bound=(await db.query("SELECT customer_id FROM customer_wallets WHERE merchant_id=$1 AND chain='solana:devnet' AND address=$2",[o.merchant_id,address])).rows[0];
 if(bound&&bound.customer_id!==o.customer_id){
  const guest=(await db.query("SELECT id FROM customers WHERE id=$1 AND name='' AND phone='' AND email='' AND notes='' AND NOT EXISTS(SELECT 1 FROM customer_wallets WHERE customer_id=$1) FOR UPDATE",[o.customer_id])).rows[0];
  if(!guest)fail('WALLET_CONFLICT',409);
  await db.query('UPDATE orders SET customer_id=$2 WHERE id=$1',[o.id,bound.customer_id]);o.customer_id=bound.customer_id;
 }
 await db.query('INSERT INTO customer_wallets(merchant_id,customer_id,address) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[o.merchant_id,o.customer_id,address]);
}
