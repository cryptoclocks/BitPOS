import type pg from 'pg';
import type {OrderRow} from './types';
import {fail} from './authority';

/** Caller holds the canonical order lock. Original issued-attempt recovery does
 * not call this: a refusal cannot erase evidence of money already sent. */
export async function assertOnlinePaymentAuthorization(db:pg.PoolClient,order:OrderRow){
 const row=(await db.query<{acceptance_status:string|null;timely:boolean|null}>(`SELECT f.acceptance_status,f.acceptance_deadline>clock_timestamp() AS timely
 FROM order_authority a LEFT JOIN online_food_orders f USING(merchant_id,order_id)
 WHERE a.merchant_id=$1 AND a.order_id=$2 AND a.source_kind='online'`,[order.merchant_id,order.id])).rows[0];
 if(row&&(row.acceptance_status===null||row.acceptance_status==='REJECTED'||row.acceptance_status==='TIMED_OUT'||row.acceptance_status==='PENDING'&&!row.timely))fail('ACCEPTANCE_UNAVAILABLE');
}
