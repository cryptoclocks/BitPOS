import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';
import {defaultTimeZone} from './opening-hours';
import {maxReportDays} from './reports';

const day=z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).refine(v=>!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v);
const query=z.object({kind:z.enum(['sales','net','stock']),from:day,to:day,cursor:z.string().uuid().optional()}).strict();
export const exportPageSize=500;
export interface ReportExportPage{kind:'sales'|'net'|'stock';from:string;to:string;timeZone:string;filename:string;csv:string;rows:number;nextCursor:string|null}
/** Text cells: neutralise spreadsheet formulas (= + - @ tab CR) and quote when needed. Only ever used for free text, never for money. */
export function csvText(value:string):string{
 const safe=/^[=+\-@\t\r]/.test(value)?`'${value}`:value;
 return /[",\n\r]/.test(safe)?`"${safe.replaceAll('"','""')}"`:safe;
}
/** Numeric cells must be plain base-10 integers (minor units, counts, signed deltas) and are emitted unquoted, never interpreted as text. */
export function csvInt(value:string|number|bigint):string{
 const text=String(value);if(!/^-?(0|[1-9][0-9]*)$/.test(text))throw Error('CSV numeric cell is not an integer');return text;
}
const line=(cells:string[])=>cells.join(',')+'\r\n';
const iso=(d:Date)=>d.toISOString();
/** Owner/manager only. Server-built, merchant-scoped, keyset-paged CSV (header on the first page only). Money is integer minor units with explicit currency and decimals; denominations are never summed. */
export async function reportExport(db:pg.PoolClient,merchant:string,actor:string,role:string,url:URL,pageSize=exportPageSize):Promise<ReportExportPage>{
 requireRole(role);
 const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)fail('INVALID_REQUEST',422);
 const q=query.safeParse(Object.fromEntries(url.searchParams));if(!q.success)fail('INVALID_REQUEST',422);
 const {kind,from,to}=q.data,cursor=q.data.cursor??null;
 const span=(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000;
 if(span<0||span+1>maxReportDays)fail('INVALID_REQUEST',422);
 const timeZone=(await db.query<{time_zone:string}>('SELECT time_zone FROM merchant_opening_hours WHERE merchant_id=$1',[merchant])).rows[0]?.time_zone??defaultTimeZone;
 const paidWindow=`o.merchant_id=$1 AND o.status='PAID' AND o.paid_at IS NOT NULL AND o.paid_at>=($2::date::timestamp AT TIME ZONE $4) AND o.paid_at<(($3::date+1)::timestamp AT TIME ZONE $4)`;
 const limit=pageSize+1,base=[merchant,from,to,timeZone,cursor];
 let header:string[],out:string[][],ids:string[];
 if(kind==='sales'){
  header=['order_id','paid_at_utc','local_day','source_kind','currency','decimals','total_minor'];
  if(cursor&&!(await db.query('SELECT 1 FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,cursor])).rowCount)fail('INVALID_REQUEST',422);
  const rows=(await db.query<{id:string;paid_at:Date;local_day:string;source_kind:string;currency:string;decimals:number;total_minor:string}>(
   `SELECT o.id,o.paid_at,to_char((o.paid_at AT TIME ZONE $4)::date,'YYYY-MM-DD') AS local_day,a.source_kind,a.catalog_currency AS currency,a.catalog_decimals AS decimals,a.total_minor::text AS total_minor
    FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE ${paidWindow}
    AND($5::uuid IS NULL OR (o.paid_at,o.id)>(SELECT paid_at,id FROM orders WHERE merchant_id=$1 AND id=$5)) ORDER BY o.paid_at,o.id LIMIT ${limit}`,base)).rows;
  ids=rows.map(r=>r.id);
  out=rows.slice(0,pageSize).map(r=>[csvText(r.id),csvText(iso(r.paid_at)),csvText(r.local_day),csvText(r.source_kind),csvText(r.currency),csvInt(r.decimals),csvInt(r.total_minor)]);
 }else if(kind==='net'){
  header=['order_id','currency','decimals','gross_minor','refunded_minor','net_minor'];
  const rows=(await db.query<{order_id:string;currency:string;decimals:number;gross:string;refunded:string;net:string}>(
   `WITH g AS(SELECT o.id AS order_id,a.catalog_currency AS currency,a.catalog_decimals AS decimals,a.total_minor AS gross FROM orders o JOIN order_authority a ON a.merchant_id=o.merchant_id AND a.order_id=o.id WHERE ${paidWindow}),
    f AS(SELECT order_id,currency,decimals,refunded_minor FROM bitpos.sales_export172_refunds($1,$2::date,$3::date,$4))
    SELECT coalesce(g.order_id,f.order_id) AS order_id,coalesce(g.currency,f.currency) AS currency,coalesce(g.decimals,f.decimals) AS decimals,
     coalesce(g.gross,0)::text AS gross,coalesce(f.refunded_minor,0)::text AS refunded,(coalesce(g.gross,0)-coalesce(f.refunded_minor,0))::text AS net
    FROM g FULL JOIN f ON f.order_id=g.order_id WHERE($5::uuid IS NULL OR coalesce(g.order_id,f.order_id)>$5::uuid) ORDER BY 1 LIMIT ${limit}`,base)).rows;
  ids=rows.map(r=>r.order_id);
  out=rows.slice(0,pageSize).map(r=>[csvText(r.order_id),csvText(r.currency),csvInt(r.decimals),csvInt(r.gross),csvInt(r.refunded),csvInt(r.net)]);
 }else{
  header=['movement_id','created_at_utc','local_day','product_id','product_name','kind','delta','stock_before','stock_after','reason','reference','actor'];
  if(cursor&&!(await db.query('SELECT 1 FROM stock_movements WHERE merchant_id=$1 AND id=$2',[merchant,cursor])).rowCount)fail('INVALID_REQUEST',422);
  const rows=(await db.query<{id:string;created_at:Date;local_day:string;product_id:string;name:string|null;kind:string;delta:number;stock_before:number;stock_after:number;reason:string;reference:string;actor:string}>(
   `SELECT m.id,m.created_at,to_char((m.created_at AT TIME ZONE $4)::date,'YYYY-MM-DD') AS local_day,m.product_id,p.name_en AS name,m.kind,m.delta,m.stock_before,m.stock_after,m.reason,m.reference,m.actor
    FROM stock_movements m LEFT JOIN products p ON p.merchant_id=m.merchant_id AND p.id=m.product_id
    WHERE m.merchant_id=$1 AND m.created_at>=($2::date::timestamp AT TIME ZONE $4) AND m.created_at<(($3::date+1)::timestamp AT TIME ZONE $4)
    AND($5::uuid IS NULL OR (m.created_at,m.id)>(SELECT created_at,id FROM stock_movements WHERE merchant_id=$1 AND id=$5)) ORDER BY m.created_at,m.id LIMIT ${limit}`,base)).rows;
  ids=rows.map(r=>r.id);
  out=rows.slice(0,pageSize).map(r=>[csvText(r.id),csvText(iso(r.created_at)),csvText(r.local_day),csvText(r.product_id),csvText(r.name??''),csvText(r.kind),csvInt(r.delta),csvInt(r.stock_before),csvInt(r.stock_after),csvText(r.reason),csvText(r.reference),csvText(r.actor)]);
 }
 const more=ids.length>pageSize;
 if(!cursor)await audit(db,merchant,actor,'report.export',kind);
 return {kind,from,to,timeZone,filename:`bitpos-${kind}-${from}_${to}.csv`,csv:(cursor?'':line(header))+out.map(line).join(''),rows:out.length,nextCursor:more?ids[pageSize-1]:null};
}
