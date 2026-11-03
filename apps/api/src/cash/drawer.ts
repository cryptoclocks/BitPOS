import type pg from 'pg';
import {z} from 'zod';
import {fail} from '../authority';
import {audit} from '../db';
import {defaultTimeZone} from '../opening-hours';
import {periodStart} from '../shifts';
import {loadSettings} from './settings';

const open=z.object({floatMinor:z.string().regex(/^(0|[1-9][0-9]{0,14})$/)}).strict();
const staffUp=(role:string)=>{if(!['owner','manager','staff'].includes(role))fail('ROLE_REQUIRED',403);};
async function roundStart(db:pg.PoolClient,merchant:string){
 const tz=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 return periodStart(db,merchant,tz);
}
/** The drawer of the current sales round: the float the shop started with, the cash sales since, and what should be in the drawer. */
export async function getDrawer(db:pg.PoolClient,merchant:string,role:string){
 staffUp(role);
 const start=await roundStart(db,merchant),s=await loadSettings(db,merchant);
 const o=(await db.query<{float_minor:string;opened_by:string;created_at:Date}>('SELECT float_minor::text,opened_by,created_at FROM cash_drawer_openings WHERE merchant_id=$1 AND period_start=$2 AND currency=$3 AND decimals=$4',[merchant,start,s.currency,s.decimals])).rows[0];
 const sales=(await db.query<{orders:number;total:string}>("SELECT count(*)::int orders,COALESCE(sum(total_minor),0)::text total FROM cash_sales WHERE merchant_id=$1 AND status='PAID' AND created_at>=$2 AND currency_code=$3 AND decimals=$4",[merchant,start,s.currency,s.decimals])).rows[0];
 const mv=(await db.query<{cin:string;cout:string}>("SELECT COALESCE(sum(amount_minor) FILTER(WHERE kind='IN'),0)::text AS cin,COALESCE(sum(amount_minor) FILTER(WHERE kind='OUT'),0)::text AS cout FROM cash_movements WHERE merchant_id=$1 AND period_start=$2",[merchant,start])).rows[0]!;
 return {periodStart:start.toISOString(),currency:s.currency,decimals:s.decimals,opening:o?{floatMinor:o.float_minor,openedBy:o.opened_by,at:o.created_at.toISOString()}:null,
  orders:sales.orders,cashSalesMinor:sales.total,cashInMinor:mv.cin,cashOutMinor:mv.cout,expectedMinor:o?(BigInt(o.float_minor)+BigInt(sales.total)+BigInt(mv.cin)-BigInt(mv.cout)).toString():null};
}
/** Records the starting float once per round; it is history afterwards, so a wrong figure is handled by the count at close, not by editing. */
export async function openDrawer(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 staffUp(role);
 const p=open.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);
 const s=await loadSettings(db,merchant);if(!s.enabled)fail('CONFIGURATION_REQUIRED',409);
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',['cash-drawer:'+merchant]);
 const start=await roundStart(db,merchant);
 const done=await db.query('INSERT INTO cash_drawer_openings(merchant_id,period_start,float_minor,currency,decimals,opened_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[merchant,start,p.data.floatMinor,s.currency,s.decimals,actor]);
 if(!done.rowCount){
  const cur=(await db.query<{float_minor:string}>('SELECT float_minor::text FROM cash_drawer_openings WHERE merchant_id=$1 AND period_start=$2',[merchant,start])).rows[0];
  if(cur?.float_minor===p.data.floatMinor)return {...(await getDrawer(db,merchant,role)),replayed:true};
  fail('INVALID_REQUEST',409);
 }
 await audit(db,merchant,actor,'cash.drawer.open',p.data.floatMinor);
 return {...(await getDrawer(db,merchant,role)),replayed:false};
}
