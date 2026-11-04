import type pg from 'pg';
import {z} from 'zod';
import {fail,requireRole} from './authority';
import {audit} from './db';

// M09: how a printed bill LOOKS (shop name, footer, default language, paper width) is a shop-wide setting kept on the server so every till prints
// the same. It never changes what a bill SAYS: lines, totals, payment state and tax wording always come from the order or cash sale itself.
// A reprint is recorded in the audit log (who, which bill, which copy) before the till prints it.
const text=(max:number)=>z.string().trim().max(max);
const save=z.object({
 shopName:text(80),shopNameEn:text(80),footer:text(160),footerEn:text(160),
 defaultLang:z.enum(['th','en','both']),paperMm:z.union([z.literal(58),z.literal(80)]),
 expectedRevision:z.number().int().min(0),
}).strict();
const reprint=z.object({kind:z.enum(['order','cash']),id:z.string().uuid()}).strict();
export interface ReceiptSettings{shopName:string;shopNameEn:string;footer:string;footerEn:string;defaultLang:'th'|'en'|'both';paperMm:58|80;revision:number;configured:boolean}
type Row={shop_name:string;shop_name_en:string;footer:string;footer_en:string;default_lang:'th'|'en'|'both';paper_mm:58|80;revision:string};
const view=(r:Row,fallback:string):ReceiptSettings=>({shopName:r.shop_name||fallback,shopNameEn:r.shop_name_en,footer:r.footer,footerEn:r.footer_en,defaultLang:r.default_lang,paperMm:r.paper_mm,revision:Number(r.revision),configured:true});

async function load(db:pg.PoolClient,merchant:string,lock=false):Promise<ReceiptSettings>{
 const name=(await db.query<{name:string}>('SELECT name FROM merchants WHERE id=$1',[merchant])).rows[0]?.name??'BitPOS';
 const r=(await db.query<Row>(`SELECT shop_name,shop_name_en,footer,footer_en,default_lang,paper_mm,revision::text FROM receipt_settings WHERE merchant_id=$1${lock?' FOR UPDATE':''}`,[merchant])).rows[0];
 return r?view(r,name):{shopName:name,shopNameEn:'',footer:'',footerEn:'',defaultLang:'th',paperMm:80,revision:0,configured:false};
}
/** Any signed-in member: the till needs the look of the bill to print it. */
export async function getReceiptSettings(db:pg.PoolClient,merchant:string){return {settings:await load(db,merchant)};}
/** Owner only. Optimistic: `expectedRevision` is 0 for the first save, otherwise the revision that was read. */
export async function saveReceiptSettings(db:pg.PoolClient,merchant:string,actor:string,role:string,input:unknown){
 requireRole(role,true);
 const p=save.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);const d=p.data;
 const cur=await load(db,merchant,true);
 if(cur.revision!==d.expectedRevision)fail('VERSION_CONFLICT',409);
 const r=cur.revision===0
  ?await db.query(`INSERT INTO receipt_settings(merchant_id,shop_name,shop_name_en,footer,footer_en,default_lang,paper_mm,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[merchant,d.shopName,d.shopNameEn,d.footer,d.footerEn,d.defaultLang,d.paperMm,actor])
  :await db.query(`UPDATE receipt_settings SET shop_name=$2,shop_name_en=$3,footer=$4,footer_en=$5,default_lang=$6,paper_mm=$7,revision=revision+1,updated_by=$8,updated_at=clock_timestamp() WHERE merchant_id=$1 AND revision=$9`,[merchant,d.shopName,d.shopNameEn,d.footer,d.footerEn,d.defaultLang,d.paperMm,actor,cur.revision]);
 if(!r.rowCount)fail('VERSION_CONFLICT',409);
 await audit(db,merchant,actor,'receipt.settings',`rev:${cur.revision+1}`);
 return {settings:await load(db,merchant)};
}
/** Any signed-in member. Records that a bill is about to be printed again and says which copy it is (2 = first reprint). Only a paid order, or a cash
 * sale (paid or voided, a voided one prints stamped), can be reprinted; an unpaid order has no receipt. The count is serialised per bill. */
export async function recordReprint(db:pg.PoolClient,merchant:string,actor:string,input:unknown){
 const p=reprint.safeParse(input);if(!p.success)fail('INVALID_REQUEST',422);const {kind,id}=p.data;
 const ok=kind==='order'
  ?(await db.query("SELECT 1 FROM orders WHERE merchant_id=$1 AND id=$2 AND status='PAID'",[merchant,id])).rowCount
  :(await db.query('SELECT 1 FROM cash_sales WHERE merchant_id=$1 AND id=$2',[merchant,id])).rowCount;
 if(!ok){
  if(kind==='order'&&(await db.query('SELECT 1 FROM orders WHERE merchant_id=$1 AND id=$2',[merchant,id])).rowCount)fail('ORDER_NOT_PAID',409);
  fail('RESOURCE_NOT_FOUND',404);
 }
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`reprint:${merchant}:${id}`]);
 const n=(await db.query<{n:number}>("SELECT count(*)::int n FROM audit_logs WHERE merchant_id=$1 AND action='receipt.reprint' AND subject=$2",[merchant,id])).rows[0]!.n;
 await audit(db,merchant,actor,'receipt.reprint',id);
 return {kind,id,copy:n+2};
}
