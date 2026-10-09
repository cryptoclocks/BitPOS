import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';
import {config} from '../../apps/api/src/config';
const name=process.argv[2]??'008_table_authority.sql';
const evidencePaths:Record<string,string>={'008_table_authority.sql':'.omp/work/evidence/table-migration.json','009_reconciliation_discovery.sql':'.omp/work/evidence/reconciliation-discovery-migration.json','010_critical_wire_routines.sql':'.omp/work/evidence/critical-wire-routines-migration.json','011_authorized_devnet_verification_budget.sql':'.omp/work/evidence/authorized-verification-budget-migration.json','012_heartbeat_wire_routine.sql':'.omp/work/evidence/heartbeat-wire-routine-migration.json','013_settlement_facts.sql':'.omp/work/evidence/settlement-facts-migration.json','014_funded_devnet_verification_budget.sql':'.omp/work/evidence/funded-verification-budget-migration.json'};
evidencePaths['015_funded_final_demo_budget.sql']='.omp/work/evidence/funded-final-demo-budget-migration.json';
if(!Object.hasOwn(evidencePaths,name))throw new Error('Only coordinator-approved additive migrations are supported');
const sql=fs.readFileSync('supabase/migrations/'+name,'utf8');
const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});
await db.connect();
try {
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
 await db.query("SELECT pg_advisory_xact_lock(hashtext('bitpos-table-migration'))");
 const applied=(await db.query('SELECT 1 FROM public.bitpos_migrations WHERE name=$1',[name])).rowCount;
 const columns:Record<string,string[]>={orders:['authority_version','recovery_resolved_at'],outbox_events:['target_device_id','target_assignment_generation','screen_generation','device_seq'],device_deliveries:['merchant_id']};
 if(name!=='008_table_authority.sql')Object.assign(columns,{device_event_deliveries:[],order_authority:[],order_quotes:[],catalog_price_versions:[],catalog_prices:[],products:[],device_screen_state:[],device_credentials:[]});
 if(['011_authorized_devnet_verification_budget.sql','014_funded_devnet_verification_budget.sql','015_funded_final_demo_budget.sql'].includes(name))Object.assign(columns,{sponsor_days:[],sponsor_orders:[],payment_attempts:[]});
 async function history(){const result:Record<string,unknown>={};for(const [table,exclude] of Object.entries(columns)){
  const rows=await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg((to_jsonb(t)-$1::text[])::text,E'\\n' ORDER BY (to_jsonb(t)-$1::text[])::text),'')) AS digest FROM bitpos.${table} t`,[exclude]);result[table]=rows.rows[0];
 }return result;}
 const before=await history();
 if(!applied){await db.query(sql);await db.query('INSERT INTO public.bitpos_migrations(name) VALUES($1)',[name]);}
 const after=await history();
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Migration changed historical data; transaction refused');
 await db.query('COMMIT');
 const evidence={origin:'actual_single_bitpos_stack_atomic_migration',migration:name,sha256:crypto.createHash('sha256').update(sql).digest('hex'),result:applied?'already_applied_noop':'applied',historical_rows_unchanged:true,history_scope:'same repeatable-read snapshot; independently concurrent runtime writes are not attributed to this migration',before,after,pricing_activated:false,device_credentials_created:false};
 fs.writeFileSync(evidencePaths[name],JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence));
} catch(error){await db.query('ROLLBACK');const e=error as {code?:string;routine?:string;table?:string;constraint?:string;position?:string};console.error(JSON.stringify({result:'refused_rolled_back',code:e.code,routine:e.routine,table:e.table,constraint:e.constraint,position:e.position}));process.exitCode=1;}finally{await db.end();}
