import {z} from 'zod';
import type pg from 'pg';
import {fail,requireRole} from '../authority';
import {audit} from '../db';

type State='not_applicable'|'receivable'|'settled'|'disputed';
const body=z.object({to:z.enum(['receivable','settled','disputed']),note:z.string().trim().max(200).default('')}).strict();
// Money a platform collected stays "receivable" until the shop has matched it with a payout; BitPOS cannot see the payout itself,
// so this is the owner's own bookkeeping, recorded with who and when. Cash on pickup and unfinished orders never take part.
const ALLOWED:Record<'receivable'|'settled'|'disputed',State[]>={receivable:['disputed','settled'],settled:['receivable','disputed'],disputed:['receivable','settled']};

export async function settleChannelOrder(db:pg.PoolClient,merchant:string,actor:string,role:string,orderId:unknown,input:unknown){
 requireRole(role);
 const id=z.string().uuid().safeParse(orderId),p=body.safeParse(input);if(!id.success||!p.success)fail('INVALID_REQUEST',422);
 const o=(await db.query<{status:string;payment_collector:string;settlement_state:State}>('SELECT status,payment_collector,settlement_state FROM channel_orders WHERE merchant_id=$1 AND id=$2 FOR UPDATE',[merchant,id.data])).rows[0];
 if(!o)fail('RESOURCE_NOT_FOUND',404);
 if(o.payment_collector!=='platform'||o.status!=='completed')fail('SETTLEMENT_NOT_READY',409);
 if(o.settlement_state===p.data.to)return {id:id.data,settlementState:o.settlement_state,replayed:true};
 if(!ALLOWED[p.data.to].includes(o.settlement_state))fail('INVALID_REQUEST',409);
 await db.query('UPDATE channel_orders SET settlement_state=$3,updated_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2',[merchant,id.data,p.data.to]);
 await db.query("INSERT INTO channel_events(merchant_id,event_key,order_id,kind,raw_status,payload) VALUES($1,$2,$3,'command',$4,$5)",[merchant,`settlement|${id.data}|${p.data.to}|${Date.now()}`,id.data,'settlement',JSON.stringify({from:o.settlement_state,to:p.data.to,note:p.data.note,by:actor})]);
 await audit(db,merchant,actor,'channel.order.settlement',`${id.data}:${o.settlement_state}->${p.data.to}`);
 return {id:id.data,settlementState:p.data.to,replayed:false};
}
