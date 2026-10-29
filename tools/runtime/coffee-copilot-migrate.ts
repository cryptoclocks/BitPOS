import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import {config} from '../../apps/api/src/config';
const name=process.argv[2],backupPath=process.argv[3];
const promotionMigrations=['035_table_occupancies.sql','036_daily_campaigns.sql','037_customer_auth_consent.sql','038_promotion_playlists.sql','039_personal_recipients.sql','040_personal_published_daily_floor.sql','041_personal_current_daily_floor.sql','042_promotion_derivations.sql'];
const batch=name==='promotions-036-039',names=batch?promotionMigrations.slice(1,5):[name];
if(!name||!(batch||/^0(29|30|31|32|33|34)_[a-z0-9_]+\.sql$/.test(name)||promotionMigrations.includes(name))||!backupPath)throw Error('Explicit authorized migration and private backup receipt required');
const tableScope=batch||promotionMigrations.includes(name);
const backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));
const archive=path.resolve(backup.privatePath);
if(!archive.startsWith(path.resolve('local/private/db-backups')+path.sep)||!backup.archiveListVerified||crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==backup.sha256)throw Error('Private backup integrity mismatch');
const age=Date.now()-Date.parse(backup.at.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z'));
if(!Number.isFinite(age)||age<0||age>3600000)throw Error('Fresh backup required');
const url=new URL(config.ADMIN_DATABASE_URL);if(url.hostname!=='127.0.0.1'||url.port!=='18780'||url.pathname!=='/postgres')throw Error('Only existing dedicated BitPOS forwarded database permitted');
const sql=names.map(n=>fs.readFileSync('supabase/migrations/'+n,'utf8')).join('\n'),db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query("SELECT pg_advisory_xact_lock(hashtext('bitpos-table-migration'))");
 const applied=(await db.query('SELECT name FROM public.bitpos_migrations WHERE name=ANY($1::text[])',[names])).rows.map(r=>r.name);if(applied.length&&applied.length!==names.length)throw Error('Partial batch exists; explicit migration recovery required');
 const tables=['orders','order_items','order_authority','order_quotes','payments','payment_attempts','products','outbox_events','device_event_deliveries','device_screen_state'];
 async function history(){const out:Record<string,unknown>={};for(const table of tables)out[table]=(await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS digest FROM bitpos.${table} t`)).rows[0];return out;}
 const before=await history();if(!applied.length){await db.query(sql);for(const migration of names)await db.query('INSERT INTO public.bitpos_migrations(name) VALUES($1)',[migration]);}const after=await history();
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Historical records changed; refuse migration');await db.query('COMMIT');
 const evidence={origin:tableScope?'existing_single_OCI_BitPOS_promotions_table_atomic_migration':'existing_single_OCI_BitPOS_coffee_copilot_atomic_migration',migration:name,migrations:names,sha256:crypto.createHash('sha256').update(sql).digest('hex'),backupReceipt:backupPath,result:applied.length?'already_applied_noop':'applied',historicalRecordsUnchanged:true,before,after};
 const directory=tableScope?'.omp/work/promotions-table-visits-20261013/evidence':'.omp/work/coffee-copilot-x402-v2-20261012/evidence';fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(directory+'/'+name+'.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch(error){await db.query('ROLLBACK');const e=error as {code?:string;position?:string;message?:string};console.error(JSON.stringify({result:'rolled_back',code:e.code,position:e.position,message:e.code?undefined:e.message}));process.exitCode=1;}finally{await db.end();}
