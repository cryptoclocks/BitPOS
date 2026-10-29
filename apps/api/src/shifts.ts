import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';
import {defaultTimeZone} from './opening-hours';

export interface ShiftGroup{currency:string;decimals:number;sourceKind:string;orders:number;totalMinor:string}
export interface ShiftSnapshot{timeZone:string;groups:ShiftGroup[];excludedOrders:number;basis:'gross_paid_before_refunds_and_fees'}
export interface ShiftClose{id:string;periodStart:string;periodEnd:string;closedBy:string;countedCash:{minor:string;currency:string;decimals:number}|null;note:string;snapshot:ShiftSnapshot;createdAt:string}
const close=z.object({idempotencyKey:z.string().min(1).max(128),note:z.string().trim().max(200).default(''),
 countedCash:z.object({minor:z.string().regex(/^(0|[1-9][0-9]{0,17})$/),currency:z.string().trim().min(3).max(10),decimals:z.number().int().min(0).max(18)}).strict().nullable().default(null)}).strict();
type Row={id:string;period_start:Date;period_end:Date;closed_by:string;counted_cash_minor:string|null;cash_currency:string|null;cash_decimals:number|null;note:string;snapshot:ShiftSnapshot;created_at:Date};
const view=(r:Row):ShiftClose=>({id:r.id,periodStart:r.period_start.toISOString(),periodEnd:r.period_end.toISOString(),closedBy:r.closed_by,countedCash:r.counted_cash_minor===null?null:{minor:String(r.counted_cash_minor),currency:r.cash_currency!,decimals:r.cash_decimals!},note:r.note,snapshot:r.snapshot,createdAt:r.created_at.toISOString()});
async function periodStart(db:pg.PoolClient,merchant:string,timeZone:string){
 const last=(await db.query<{period_end:Date}>('SELECT period_end FROM shift_closes WHERE merchant_id=$1 ORDER BY period_end DESC LIMIT 1',[merchant])).rows[0];
 if(last)return last.period_end;
 return (await db.query<{start:Date}>("SELECT (date_trunc('day',clock_timestamp() AT TIME ZONE $1) AT TIME ZONE $1) AS start",[timeZone])).rows[0].start;
}
async function totals(db:pg.PoolClient,merchant:string,from:Date,to:Date,timeZone:string):Promise<ShiftSnapshot>{
 const window='o.merchant_id=$1 AND o.status=\'PAID\' AND o.paid_at IS NOT NULL AND o.paid_at>=$2 AND o.paid_at<$3';
 const rows=(await db.query<{currency:string;decimals:number;source_kind:string;orders:number;total_minor:string}>(
  `SELECT a.catalog_currency AS currency,a.catalog_decimals AS decimals,a.source_kind,count(*)::int AS orders,sum(a.total_minor)::text AS total_minor
   FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE ${window} GROUP BY 1,2,3 ORDER BY 1,2,3`,[merchant,from,to])).rows;
 const excluded=(await db.query<{n:number}>(`SELECT count(*)::int AS n FROM orders o WHERE ${window} AND NOT EXISTS(SELECT 1 FROM order_authority a WHERE a.merchant_id=o.merchant_id AND a.order_id=o.id)`,[merchant,from,to])).rows[0].n;
 return {timeZone,groups:rows.map(r=>({currency:r.currency,decimals:r.decimals,sourceKind:r.source_kind,orders:r.orders,totalMinor:r.total_minor})),excludedOrders:excluded,basis:'gross_paid_before_refunds_and_fees'};
}
/** Owner/manager only. The open period runs from the previous close (or the start of the shop's day) to now; closing freezes the
 * server-computed paid totals in one immutable row. Counted cash is only what the person declared; money is never summed across currencies. */
export async function shiftsRequest(db:pg.PoolClient,merchant:string,actor:string,role:string,url:URL,method:string,input:unknown){
 requireRole(role);
 const timeZone=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 if(url.pathname==='/api/shifts'&&method==='GET'){
  if(url.search)fail('INVALID_REQUEST',422);
  const start=await periodStart(db,merchant,timeZone),now=(await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now;
  const closes=(await db.query<Row>('SELECT id,period_start,period_end,closed_by,counted_cash_minor::text,cash_currency,cash_decimals,note,snapshot,created_at FROM shift_closes WHERE merchant_id=$1 ORDER BY period_end DESC LIMIT 20',[merchant])).rows.map(view);
  return {open:{periodStart:start.toISOString(),asOf:now.toISOString(),snapshot:await totals(db,merchant,start,now,timeZone)},closes};
 }
 if(url.pathname==='/api/shifts/close'&&method==='POST'){
  const data=close.safeParse(input);if(!data.success)fail('INVALID_REQUEST',422);
  const d=data.data;
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['shift-close:'+merchant]);
  const prior=(await db.query<Row>('SELECT id,period_start,period_end,closed_by,counted_cash_minor::text,cash_currency,cash_decimals,note,snapshot,created_at FROM shift_closes WHERE merchant_id=$1 AND idempotency_key=$2',[merchant,d.idempotencyKey])).rows[0];
  if(prior)return {close:view(prior),replayed:true};
  const start=await periodStart(db,merchant,timeZone),end=(await db.query<{now:Date}>('SELECT clock_timestamp() AS now')).rows[0].now;
  if(!(end>start))fail('INVALID_REQUEST',422);
  const snapshot=await totals(db,merchant,start,end,timeZone),cash=d.countedCash;
  const row=(await db.query<Row>('INSERT INTO shift_closes(merchant_id,period_start,period_end,closed_by,counted_cash_minor,cash_currency,cash_decimals,note,snapshot,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,period_start,period_end,closed_by,counted_cash_minor::text,cash_currency,cash_decimals,note,snapshot,created_at',
   [merchant,start,end,actor,cash?cash.minor:null,cash?cash.currency:null,cash?cash.decimals:null,d.note,JSON.stringify(snapshot),d.idempotencyKey])).rows[0];
  await audit(db,merchant,actor,'shift.close',row.id);
  return {close:view(row),replayed:false};
 }
 fail('RESOURCE_NOT_FOUND',404);
}
