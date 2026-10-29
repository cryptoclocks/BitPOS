import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import pg from 'pg';
// Shared WP3b fixture: one rolled-back READ COMMITTED transaction on the disposable
// fixture database, seeded from an existing online configured pickup quote with a
// mobile session. Payment facts elsewhere are SQL-only verifier seams.
export type Q=Record<string,any>;
export async function withFixture(body:(c:{db:pg.Client;source:Q;quote:(ms?:number)=>Promise<string>;policy:(o?:{global?:number;account?:number;budget?:string;funding?:number})=>Promise<string>;apply:(quote:string,policy:string)=>Promise<Q>;order:(quoteId:string,key?:string)=>Promise<Q>;rejected:(fn:()=>Promise<unknown>,message:string)=>Promise<void>;modules:{createQuotedOrder:any;settleAttempt:any;prepare:any}})=>Promise<void>){
 const {config}=await import('../apps/api/src/config');
 const orders=await import('../apps/api/src/orders');const candidate=await import('../apps/api/src/coupon-quote-candidate');
 const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL READ COMMITTED');await db.query('SET LOCAL search_path=bitpos,public');
  const source=(await db.query(`SELECT q.* FROM order_quotes q JOIN quote_configured_food d ON(d.merchant_id,d.quote_id)=(q.merchant_id,q.id) JOIN mobile_accounts a ON a.id=q.source_account_id
   JOIN merchant_pricing m ON m.merchant_id=q.merchant_id AND m.active_price_version_id=q.price_version_id AND m.revision=q.pricing_revision
   JOIN mobile_customer_links l ON l.merchant_id=q.merchant_id AND l.account_id=q.source_account_id
   WHERE q.origin_kind='online' AND q.authority->'serving'->>'kind'='pickup' AND a.disabled_at IS NULL AND q.total_minor>1 AND q.coupon098_version IS NULL
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q.lines)l WHERE l?'scopedPromotion' OR l?'dailyPromotion' OR l?'personalPromotion' OR l?'bundle')
   AND NOT EXISTS(SELECT 1 FROM quote_coffee_constraints WHERE merchant_id=q.merchant_id AND quote_id=q.id) AND NOT EXISTS(SELECT 1 FROM quote_table_occupancies WHERE merchant_id=q.merchant_id AND quote_id=q.id)
   ORDER BY q.quoted_at DESC LIMIT 1`)).rows[0] as Q;
  assert.ok(source,'fixture needs a current-price online configured pickup quote');
  // Open the branch for pickup inside the rolled-back transaction only.
  await db.query('UPDATE marketplace_branches SET enabled=true,pickup_enabled=true WHERE merchant_id=$1 AND id=$2',[source.merchant_id,source.source_branch_id]);
  const columns=(await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='bitpos' AND table_name='order_quotes' AND is_generated='NEVER' AND is_identity='NO' ORDER BY ordinal_position")).rows.map(r=>'"'+String(r.column_name).replaceAll('"','""')+'"');
  const sid=randomUUID(),tokenHash=createHash('sha256').update(randomBytes(32)).digest('hex');
  await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[sid,source.source_account_id,randomUUID(),tokenHash,createHash('sha256').update(randomBytes(32)).digest('hex')]);
  await db.query("SELECT set_config('bitpos.merchant',$1,true),set_config('bitpos.mobile_account',$2,true),set_config('bitpos.mobile_session',$3,true),set_config('bitpos.mobile_access_hash',$4,true)",[source.merchant_id,source.source_account_id,sid,tokenHash]);
  const quote=async(ms=120000)=>{await db.query('SET CONSTRAINTS ALL DEFERRED');const id=randomUUID();
   await db.query(`INSERT INTO order_quotes(${columns.join(',')})SELECT ${columns.map(c=>'copied.'+c).join(',')}FROM order_quotes q CROSS JOIN LATERAL jsonb_populate_record(NULL::order_quotes,to_jsonb(q)||jsonb_build_object('id',$2::uuid,'quoted_at',clock_timestamp(),'valid_until',clock_timestamp()+$3::integer*interval '1 millisecond'))copied WHERE q.id=$1`,[source.id,id,ms]);
   await db.query('INSERT INTO quote_configured_food(merchant_id,quote_id,items,snapshot)SELECT merchant_id,$2,items,snapshot FROM quote_configured_food WHERE quote_id=$1',[source.id,id]);
   await db.query('SET CONSTRAINTS ALL IMMEDIATE');return id;};
  const policy=async(o:{global?:number;account?:number;budget?:string;funding?:number}={})=>{const campaign=randomUUID(),version=randomUUID();
   await db.query("INSERT INTO coupon097_campaigns(id,merchant_id,code,name)VALUES($1,$2,$3,'DS41 test coupon')",[campaign,source.merchant_id,'C'+randomUUID().replaceAll('-','').slice(0,20).toUpperCase()]);
   await db.query("INSERT INTO coupon097_versions(id,merchant_id,campaign_id,revision,price_version_id,discount_kind,fixed_minor,minimum_food_minor,maximum_discount_minor,global_cap,account_cap,budget_minor,merchant_funding_bps,serving,starts_at,expires_at)VALUES($1,$2,$3,1,$4,'FIXED',1,0,1000,$5,$6,$7,$8,ARRAY['pickup'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 hour')",[version,source.merchant_id,campaign,source.price_version_id,o.global??5,o.account??5,o.budget??'1000',o.funding??10000]);
   await db.query('UPDATE coupon097_campaigns SET active_version_id=$2,enabled=true WHERE id=$1',[campaign,version]);return version;};
  const apply=async(quoteId:string,policyId:string)=>{await db.query('SET CONSTRAINTS ALL DEFERRED');const r=await candidate.prepareCouponQuoteCandidate(db,source.merchant_id,quoteId,policyId,randomUUID());await db.query('SET CONSTRAINTS ALL IMMEDIATE');return r as Q;};
  const customer=(await db.query('SELECT customer_id FROM mobile_customer_links WHERE merchant_id=$1 AND account_id=$2',[source.merchant_id,source.source_account_id])).rows[0].customer_id;
  const order=async(quoteId:string,key:string=randomUUID())=>{await db.query('SET CONSTRAINTS ALL DEFERRED');const q=(await db.query('SELECT * FROM order_quotes WHERE id=$1',[quoteId])).rows[0];
   const o=await orders.createQuotedOrder(db as unknown as pg.PoolClient,source.merchant_id,{quote:q,customerId:customer,idempotencyKey:key,requestHash:'ds41-'+key,screenGeneration:null});await db.query('SET CONSTRAINTS ALL IMMEDIATE');return o as Q;};
  const rejected=async(fn:()=>Promise<unknown>,message:string)=>{await db.query('SAVEPOINT expected');try{await assert.rejects(fn,(e:any)=>String(e.message).includes(message)||e?.detail===message,message);}finally{await db.query('ROLLBACK TO SAVEPOINT expected');}};
  await body({db,source,quote,policy,apply,order,rejected,modules:{createQuotedOrder:orders.createQuotedOrder,settleAttempt:orders.settleAttempt,prepare:candidate.prepareCouponQuoteCandidate}});
 }finally{await db.query('ROLLBACK').catch(()=>undefined);await db.end();}
}
