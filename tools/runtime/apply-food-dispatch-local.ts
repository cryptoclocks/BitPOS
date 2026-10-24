import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
// Deliberately cannot consume root environment or target the actual-use stack.
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await db.connect();
const applied:{name:string;sha256:string;mode:string}[]=[];
try{
 await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('bitpos.local.food-dispatch.migrations',0))");
 assert.equal((await db.query('SELECT current_database() AS name')).rows[0].name,'bitpos_delivery_fixture');
 await db.query('CREATE TABLE IF NOT EXISTS public.bitpos_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())');
 await db.query('ALTER TABLE public.bitpos_migrations ADD COLUMN IF NOT EXISTS source_sha256 text');
 for(const name of ['061_food_dispatch_runtime.sql','062_food_earning_obligations.sql','063_food_custody_earnings.sql','064_food_allocation_guards.sql','065_food_driver_work.sql','066_food_merchant_work.sql','067_food_customer_work.sql','068_food_proof_expiry_recovery.sql']){
  const source=await readFile('supabase/migrations/'+name,'utf8'),sha256=createHash('sha256').update(source).digest('hex');
  const prior=(await db.query('SELECT source_sha256 FROM public.bitpos_migrations WHERE name=$1',[name])).rows[0];
  if(prior){assert.equal(prior.source_sha256,sha256,'Applied local migration drift: '+name);applied.push({name,sha256,mode:'already_applied_identical'});continue;}
  let sql=source,mode='full_migration';
  if(name.startsWith('061')&&(await db.query("SELECT to_regclass('bitpos.food_dispatch_offers') AS installed")).rows[0].installed){
   // This mission's recorded compile/bootstrap installed only the first061 base
   // tables/helpers. Complete the current command closure, not historical files.
   sql='SET LOCAL search_path=bitpos,public;\n'+source.slice(source.indexOf('CREATE FUNCTION dispatch_live_actor')).replaceAll('CREATE FUNCTION ','CREATE OR REPLACE FUNCTION ');mode='complete_preexisting061_base';
  }
  await db.query(sql);await db.query('INSERT INTO public.bitpos_migrations(name,source_sha256) VALUES($1,$2)',[name,sha256]);applied.push({name,sha256,mode});
 }
 await db.query('COMMIT');const receipt={status:'PASS',database:'127.0.0.1:55436/bitpos_delivery_fixture',applied,production:false,limits:['Local fixture schema activation only; no HTTP/AVD, external payment or payout acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch061-068-local-apply-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
