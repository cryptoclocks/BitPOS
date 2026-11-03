import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from '../authority';
import {audit} from '../db';
import {defaultTimeZone} from '../opening-hours';
import {periodStart} from '../shifts';
import {loadSettings} from './settings';

// M06: cash put into / taken out of the drawer during the open round, each with a reason. Insert-only (a mistake is answered with an opposite
// entry). expected cash = opening float + cash sales + cash in - cash out. Taking cash out can never push the expected figure below zero.
export interface CashMovement{id:string;periodStart:string;kind:'IN'|'OUT';amountMinor:string;currency:string;decimals:number;reason:string;createdBy:string;createdAt:string}
const staffUp=(role:string)=>{if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);};
const body=z.object({idempotencyKey:z.string().min(8).max(128),kind:z.enum(['IN','OUT']),amountMinor:z.string().regex(/^[1-9][0-9]{0,14}$/),reason:z.string().trim().min(3).max(120)}).strict();
type Row={id:string;period_start:Date;kind:'IN'|'OUT';amount_minor:string;currency:string;decimals:number;reason:string;created_by:string;created_at:Date};
const COLS='id,period_start,kind,amount_minor::text,currency,decimals,reason,created_by,created_at';
const view=(r:Row):CashMovement=>({id:r.id,periodStart:r.period_start.toISOString(),kind:r.kind,amountMinor:r.amount_minor,currency:r.currency,decimals:r.decimals,reason:r.reason,createdBy:r.created_by,createdAt:r.created_at.toISOString()});
async function tz(db:pg.PoolClient,merchant:string){return (await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;}

/** Any signed-in member: movements of the open round (default) or of an earlier round, newest first. */
export async function listMovements(db:pg.PoolClient,merchant:string,role:string,url:URL){
 staffUp(role);
 const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length||keys.some(k=>k!=='periodStart'))fail('INVALID_REQUEST',422);
 const given=url.searchParams.get('periodStart');
 let start:Date;
 if(given){const t=z.string().datetime({offset:true}).safeParse(given);if(!t.success)fail('INVALID_REQUEST',422);start=new Date(t.data);}else start=await periodStart(db,merchant,await tz(db,merchant));
 const rows=(await db.query<Row>(`SELECT ${COLS} FROM cash_movements WHERE merchant_id=$1 AND period_start=$2 ORDER BY created_at DESC,id DESC LIMIT 200`,[merchant,start])).rows;
 return {periodStart:start.toISOString(),movements:rows.map(view)};
}

/** Cash in: staff and above. Cash out: owner/manager (it takes money away from the till). Idempotent per key; a different body under the same key is refused. */
export async function addMovement(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 staffUp(role);
 const p=body.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);
 const d=p.data;if(d.kind==='OUT')requireRole(role);
 const s=await loadSettings(db,merchant);if(!s.enabled)fail('CONFIGURATION_REQUIRED',409);
 // A running close waits for us (and we wait for it), so a movement is never half in a closed round.
 await db.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))',['shift-close:'+merchant]);
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cash-drawer:'+merchant]);
 const prior=(await db.query<Row&{idempotency_key:string}>(`SELECT ${COLS},idempotency_key FROM cash_movements WHERE merchant_id=$1 AND idempotency_key=$2`,[merchant,d.idempotencyKey])).rows[0];
 if(prior){if(prior.kind!==d.kind||prior.amount_minor!==d.amountMinor||prior.reason!==d.reason)fail('IDEMPOTENCY_CONFLICT');return {movement:view(prior),replayed:true};}
 const start=await periodStart(db,merchant,await tz(db,merchant));
 const opening=(await db.query<{float_minor:string;currency:string;decimals:number}>('SELECT float_minor::text,currency,decimals FROM cash_drawer_openings WHERE merchant_id=$1 AND period_start=$2',[merchant,start])).rows[0];
 if(!opening)fail('DRAWER_NOT_OPEN',409);
 if(opening.currency!==s.currency||opening.decimals!==s.decimals)fail('INVALID_CURRENCY',422);
 const f=(await db.query<{sales:string;cin:string;cout:string}>(`SELECT
   (SELECT COALESCE(sum(total_minor),0)::text FROM cash_sales WHERE merchant_id=$1 AND status='PAID' AND created_at>=$2 AND currency_code=$3 AND decimals=$4) AS sales,
   (SELECT COALESCE(sum(amount_minor),0)::text FROM cash_movements WHERE merchant_id=$1 AND period_start=$2 AND kind='IN') AS cin,
   (SELECT COALESCE(sum(amount_minor),0)::text FROM cash_movements WHERE merchant_id=$1 AND period_start=$2 AND kind='OUT') AS cout`,[merchant,start,s.currency,s.decimals])).rows[0]!;
 const expected=BigInt(opening.float_minor)+BigInt(f.sales)+BigInt(f.cin)-BigInt(f.cout);
 if(d.kind==='OUT'&&BigInt(d.amountMinor)>expected)fail('INSUFFICIENT_CASH',409);
 const row=(await db.query<Row>(`INSERT INTO cash_movements(merchant_id,period_start,kind,amount_minor,currency,decimals,reason,created_by,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLS}`,[merchant,start,d.kind,d.amountMinor,s.currency,s.decimals,d.reason,actor,d.idempotencyKey])).rows[0]!;
 await audit(db,merchant,actor,d.kind==='IN'?'cash.movement.in':'cash.movement.out',row.id);
 return {movement:view(row),replayed:false};
}
