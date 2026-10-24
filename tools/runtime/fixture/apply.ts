// Disposable fixture bootstrap/doctor. Never imports dotenv or production config.
import{execFileSync}from'node:child_process';import pg from 'pg';import{readFile,readdir}from'node:fs/promises';import{createHash}from'node:crypto';
const url=new URL(process.env.BITPOS_W01_DATABASE_URL??'');
if(url.hostname!=='127.0.0.1'||url.port!=='55446'||url.pathname!=='/bitpos_w01_fixture')throw Error('Only W01 named disposable loopback database allowed');
const manifest=JSON.parse(await readFile('tools/runtime/fixture/migrations.json','utf8'));
const files=(await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
if(JSON.stringify(files)!==JSON.stringify(manifest.migrations.map((m:any)=>m.name)))throw Error('Migration inventory drift');
for(const item of manifest.migrations){if(createHash('sha256').update(await readFile('supabase/migrations/'+item.name)).digest('hex')!==item.sha256)throw Error('Migration source drift: '+item.name);}
const db=new pg.Client({connectionString:url.href});await db.connect();
try{
 if(!process.argv.includes('--check')){
 await db.query("DO $$ BEGIN CREATE ROLE bitpos_app LOGIN;EXCEPTION WHEN duplicate_object THEN NULL;END $$;CREATE TABLE IF NOT EXISTS public.bitpos_fixture_migrations(name text PRIMARY KEY,source_sha256 text NOT NULL,effective_sha256 text NOT NULL,fixture_override text)");
 for(const item of manifest.migrations){if(item.admission!=='local-runtime')continue;
 const old=(await db.query('SELECT * FROM public.bitpos_fixture_migrations WHERE name=$1',[item.name])).rows[0];if(old){if(old.source_sha256!==item.sha256)throw Error('Applied migration drift');continue;}
 let sql=await readFile('supabase/migrations/'+item.name,'utf8'),override=null;
 if(item.name==='029_coffee_copilot.sql'){
 const assertion="DO $$ BEGIN IF (SELECT count(*) FROM ai_free_requests WHERE purpose='promotion')<3 THEN RAISE EXCEPTION 'Expected at least three historical Gemini starts; reconcile history before rollout'; END IF; END $$;";
 if(sql.split(assertion).length!==2)throw Error('Fixture029 override no longer matches');
 sql=sql.replace(assertion,'-- Empty disposable fixture only: no historical provider starts required.');override='EMPTY_FIXTURE_029_HISTORY_ASSERTION_ONLY';
 }
 await db.query('BEGIN');try{await db.query(sql);await db.query('INSERT INTO public.bitpos_fixture_migrations VALUES($1,$2,$3,$4)',[item.name,item.sha256,createHash('sha256').update(sql).digest('hex'),override]);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
 }
 }
 const applied=(await db.query('SELECT * FROM public.bitpos_fixture_migrations ORDER BY name')).rows;
 const expected=manifest.migrations.filter((m:any)=>m.admission==='local-runtime');
 if(applied.length!==expected.length||applied.some((r:any,i:number)=>r.name!==expected[i].name||r.source_sha256!==expected[i].sha256))throw Error('Applied schema admission drift');
 const schema=execFileSync('/opt/homebrew/opt/postgresql@17/bin/pg_dump',['--dbname',url.href,'--schema-only','--schema=bitpos','--no-owner'],{encoding:'utf8',maxBuffer:32*1024*1024}).split('\n').filter(line=>!line.startsWith('\\restrict ')&&!line.startsWith('\\unrestrict ')).join('\n');
 const schemaSha256=createHash('sha256').update(schema).digest('hex');
 if(!process.argv.includes('--check'))await db.query('CREATE TABLE IF NOT EXISTS public.bitpos_fixture_schema_fingerprint(id boolean PRIMARY KEY DEFAULT true CHECK(id),sha256 text NOT NULL)');
 const fingerprint=(await db.query('SELECT sha256 FROM public.bitpos_fixture_schema_fingerprint WHERE id')).rows[0];
 if(fingerprint&&fingerprint.sha256!==schemaSha256)throw Error('Actual PostgreSQL schema drift');
 if(!fingerprint){if(process.argv.includes('--check'))throw Error('Missing schema fingerprint');await db.query('INSERT INTO public.bitpos_fixture_schema_fingerprint VALUES(true,$1)',[schemaSha256]);}
 const forbidden=(await db.query("SELECT to_regclass('bitpos.coupon097_holds') coupon,to_regclass('bitpos.schedule107_holds') schedule")).rows[0];if(forbidden.coupon||forbidden.schedule)throw Error('Unadmitted candidate schema present');
 console.log(JSON.stringify({status:'PASS_FIXTURE_ADMISSION',applied:applied.length,candidates:manifest.migrations.filter((m:any)=>m.admission==='candidate').map((m:any)=>m.name),overrides:applied.filter((r:any)=>r.fixture_override),schemaOnly:true,schemaSha256}));
}finally{await db.end();}
