import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import {config} from '../../apps/api/src/config';
const name=process.argv[2],backupPath=process.argv[3];
if(!name||!/^0(22|23|24|25|26|27|28)_[a-z_]+\.sql$/.test(name)||!backupPath)throw Error('Explicit post-submit migration and verified private backup receipt required');
const backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));
const archive=path.resolve(backup.privatePath);
if(!archive.startsWith(path.resolve('local/private/db-backups')+path.sep)||!backup.archiveListVerified||crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==backup.sha256)throw Error('Private backup integrity mismatch');
if(Date.now()-Date.parse(backup.at.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/,'$1-$2-$3T$4:$5:$6Z'))>3600000)throw Error('Fresh backup required');
const url=new URL(config.ADMIN_DATABASE_URL);if(url.hostname!=='127.0.0.1'||url.port!=='18780'||url.pathname!=='/postgres')throw Error('Only existing dedicated BitPOS forwarded database permitted');
const sql=fs.readFileSync('supabase/migrations/'+name,'utf8'),db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});
await db.connect();
try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');await db.query("SELECT pg_advisory_xact_lock(hashtext('bitpos-table-migration'))");
 const applied=(await db.query('SELECT 1 FROM public.bitpos_migrations WHERE name=$1',[name])).rowCount;
 const tables=['orders','order_items','order_authority','order_quotes','payments','payment_attempts','products','outbox_events','device_event_deliveries','device_screen_state'];
 async function history(){const out:Record<string,unknown>={};for(const table of tables)out[table]=(await db.query(`SELECT count(*)::int AS count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS digest FROM bitpos.${table} t`)).rows[0];return out;}
 const before=await history();if(!applied){await db.query(sql);await db.query('INSERT INTO public.bitpos_migrations(name) VALUES($1)',[name]);}const after=await history();
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Historical records changed; refuse migration');
 await db.query('COMMIT');
 const evidence={origin:'existing_single_OCI_BitPOS_atomic_migration',migration:name,sha256:crypto.createHash('sha256').update(sql).digest('hex'),backupReceipt:backupPath,result:applied?'already_applied_noop':'applied',historicalRecordsUnchanged:true,before,after};
 fs.mkdirSync('.omp/work/post-submit-20261012/evidence',{recursive:true});fs.writeFileSync('.omp/work/post-submit-20261012/evidence/'+name+'.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch(error){await db.query('ROLLBACK');const e=error as {code?:string;position?:string;message?:string};console.error(JSON.stringify({result:'rolled_back',code:e.code,position:e.position,message:e.code?undefined:e.message}));process.exitCode=1;}finally{await db.end();}
