import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';
import {defaultTimeZone} from './opening-hours';

export type Unavailable='PAUSED'|'OUTSIDE_HOURS';
export interface ProductAvailability{productId:string;revision:string;paused:boolean;pausedAt:string|null;pausedUntil:string|null;pausedReason:string;sellFrom:string|null;sellTo:string|null;unavailable:Unavailable|null}
const uuid=z.string().uuid();
const hhmm=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const reason=z.string().trim().max(120);
// pause: null = resume now. until: null = until someone resumes it. window: null = sell all day. A field that is absent is left as it is.
const body=z.object({
 expectedRevision:z.string().regex(/^[1-9][0-9]{0,18}$/),
 pause:z.union([z.null(),z.object({until:z.string().datetime({offset:true}).nullable(),reason:reason.default('')}).strict()]).optional(),
 window:z.union([z.null(),z.object({from:hhmm,to:hhmm}).strict().refine(w=>w.from!==w.to)]).optional(),
}).strict().refine(b=>b.pause!==undefined||b.window!==undefined);

type Row={id:string;paused_at:Date|null;paused_until:Date|null;paused_reason:string;sell_from:string|null;sell_to:string|null;availability_revision:string;unavailable:Unavailable|null};
const cols="id,paused_at,paused_until,paused_reason,to_char(sell_from,'HH24:MI') AS sell_from,to_char(sell_to,'HH24:MI') AS sell_to,availability_revision::text,bitpos.product_unavailable_reason(paused_at,paused_until,sell_from,sell_to,clock_timestamp(),coalesce((SELECT h.time_zone FROM merchant_opening_hours h WHERE h.merchant_id=products.merchant_id),$2)) AS unavailable";
const view=(r:Row):ProductAvailability=>({productId:r.id,revision:r.availability_revision,paused:!!r.paused_at&&(!r.paused_until||r.paused_until.getTime()>Date.now()),pausedAt:r.paused_at?.toISOString()??null,pausedUntil:r.paused_until?.toISOString()??null,pausedReason:r.paused_reason,sellFrom:r.sell_from,sellTo:r.sell_to,unavailable:r.unavailable});

/** Staff and above: which products are paused or restricted right now. (Customers only ever see the resulting "unavailable" flag on the menu.) */
export async function listAvailability(db:pg.PoolClient,merchant:string,role:string){
 void role;
 const rows=(await db.query<Row>(`SELECT ${cols} FROM products WHERE merchant_id=$1 AND archived_at IS NULL ORDER BY sort_order,id`,[merchant,defaultTimeZone])).rows;
 return {availability:rows.map(view)};
}

/** Pausing/resuming is an operating action any signed-in staff member may take; the selling window is a menu decision for owner/manager.
 * Optimistic concurrency by revision. Never changes stock, prices, reservations or quotes already issued: a quote made before the pause is
 * refused at acceptance by `validateQuote` (PRODUCT_PAUSED / OUTSIDE_SELLING_HOURS), a paid order is never touched. */
export async function setAvailability(db:pg.PoolClient,merchant:string,actor:string,role:string,productId:string,input:unknown):Promise<ProductAvailability>{
 const id=uuid.safeParse(productId),data=body.safeParse(input);if(!id.success||!data.success)fail('INVALID_REQUEST',422);
 if(data.data.window!==undefined)requireRole(role);
 const row=(await db.query<Row>(`SELECT ${cols} FROM products WHERE merchant_id=$1 AND id=$3 AND archived_at IS NULL FOR UPDATE`,[merchant,defaultTimeZone,id.data])).rows[0];
 if(!row)fail('RESOURCE_NOT_FOUND',404);
 if(row.availability_revision!==data.data.expectedRevision)fail('PRODUCT_CHANGED');
 const {pause,window:w}=data.data;
 if(pause&&pause.until&&Date.parse(pause.until)<=Date.now())fail('INVALID_REQUEST',422);
 const sets:string[]=[],args:unknown[]=[merchant,id.data];
 const arg=(v:unknown)=>{args.push(v);return '$'+args.length;};
 if(pause===null)sets.push("paused_at=NULL","paused_until=NULL","paused_by=NULL","paused_reason=''");
 else if(pause)sets.push('paused_at=clock_timestamp()','paused_until='+arg(pause.until)+'::timestamptz','paused_by='+arg(actor)+'::uuid','paused_reason='+arg(pause.reason));
 if(w===null)sets.push('sell_from=NULL','sell_to=NULL');else if(w)sets.push('sell_from='+arg(w.from)+'::time','sell_to='+arg(w.to)+'::time');
 await db.query(`UPDATE products SET ${sets.join(',')},availability_revision=availability_revision+1 WHERE merchant_id=$1 AND id=$2`,args);
 await audit(db,merchant,actor,pause===null?'catalog.product.resume':pause?'catalog.product.pause':'catalog.product.window',id.data);
 const out=(await db.query<Row>(`SELECT ${cols} FROM products WHERE merchant_id=$1 AND id=$3`,[merchant,defaultTimeZone,id.data])).rows[0]!;
 return view(out);
}

/** Used by the cash register: throws the same stable codes as quote acceptance. */
export async function assertSellable(db:pg.PoolClient,merchant:string,productIds:string[]){
 if(!productIds.length)return;
 const rows=(await db.query<{unavailable:Unavailable|null}>(`SELECT bitpos.product_unavailable_reason(paused_at,paused_until,sell_from,sell_to,clock_timestamp(),coalesce((SELECT h.time_zone FROM merchant_opening_hours h WHERE h.merchant_id=products.merchant_id),$3)) AS unavailable FROM products WHERE merchant_id=$1 AND id=ANY($2::uuid[])`,[merchant,productIds,defaultTimeZone])).rows;
 const bad=rows.find(r=>r.unavailable);
 if(bad)fail(bad.unavailable==='PAUSED'?'PRODUCT_PAUSED':'OUTSIDE_SELLING_HOURS',409);
}
