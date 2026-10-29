import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {readdir, readFile, writeFile} from 'node:fs/promises';

// No dotenv: this command must never inherit the repository's actual-use DB URL.
const url = new URL(process.env.BITPOS_DELIVERY_FIXTURE_DATABASE_URL ?? 'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture');
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash || url.hostname !== '127.0.0.1' || !/^\d{4,5}$/.test(url.port) || Number(url.port) < 1024 || url.pathname !== '/bitpos_delivery_fixture') {
  throw new Error('Disposable delivery database must use a loopback URL ending in /bitpos_delivery_fixture');
}
const fixturePort = Number(url.port);
const fresh = process.argv.includes('--verify-fresh');
const control = fresh ? new pg.Client({connectionString: url.toString()}) : null;
let freshName: string | undefined;
if (control) {
  await control.connect();
  freshName = 'bitpos_delivery_schema_' + randomBytes(8).toString('hex');
  await control.query(`CREATE DATABASE "${freshName}"`);
  url.pathname = '/' + freshName;
}
const db = new pg.Client({connectionString: url.toString()});
try {
  await db.connect();
  await db.query('SELECT pg_advisory_lock(20261016,$1)', [fixturePort]);
  await db.query('CREATE TABLE IF NOT EXISTS public.bitpos_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  for (const name of (await readdir('supabase/migrations')).filter(n => n.endsWith('.sql')).sort()) {
    if ((await db.query('SELECT 1 FROM public.bitpos_migrations WHERE name=$1', [name])).rowCount) continue;
    await db.query('BEGIN');
    try {
      if (name === '029_coffee_copilot.sql') {
        // Legacy rollout requires three pre-existing generation starts. These are
        // explicitly synthetic historical rows, not provider calls or spend proof.
        await db.query(`INSERT INTO bitpos.merchants(id,name,treasury)
          VALUES('fd000000-0000-4000-8000-000000000029','FIXTURE migration history — no provider calls','FIXTURE_NOT_A_WALLET') ON CONFLICT DO NOTHING`);
        await db.query(`INSERT INTO bitpos.ai_generation_jobs(merchant_id,id,state,actor_id,input,products,attempts,provider_origin,provider_model,created_at)
          SELECT 'fd000000-0000-4000-8000-000000000029',('fd000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
          'FAILED','FIXTURE_LOCAL_MIGRATION', '{"fixture":true,"actualProviderCall":false}'::jsonb,'[]'::jsonb,1,
          'https://generativelanguage.googleapis.com','FIXTURE_NO_CALL',timestamptz '2020-01-01 UTC'
          FROM generate_series(1,3) n ON CONFLICT DO NOTHING`);
      }
      await db.query(await readFile('supabase/migrations/' + name, 'utf8'));
      await db.query('INSERT INTO public.bitpos_migrations(name) VALUES($1)', [name]);
      await db.query('COMMIT');
      console.log('Applied disposable schema', name);
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  }
  const result = await db.query('SELECT count(*)::int AS migrations FROM public.bitpos_migrations');
  if(fresh){
    const permissions=(await db.query("SELECT relname,has_table_privilege('bitpos_app',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS direct FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bitpos' AND relname IN ('platform_staff_role_grants','driver_profiles','driver_vehicles','driver_occupancy','driver_availability','driver_identity_commands','driver_identity_audit') ORDER BY relname")).rows;
    if(permissions.length!==7||permissions.some(row=>row.direct))throw Error('Driver private table privilege leaked');
    const boundaries=(await db.query("SELECT proname,has_function_privilege('bitpos_app',p.oid,'EXECUTE') AS executable,prosecdef,proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='bitpos' AND proname LIKE 'driver_%' ORDER BY proname")).rows;
    if(boundaries.length!==6||boundaries.some(row=>!row.prosecdef||!row.proconfig.includes('search_path=bitpos, pg_temp')||row.executable!==['driver_identity_snapshot','driver_identity_command','driver_verification_queue','driver_staff_roles'].includes(row.proname)))throw Error('Driver function boundary privilege mismatch');
    await writeFile('.omp/work/flutter-delivery-20261016/evidence/p2-driver-fresh-schema.json',JSON.stringify({environment:'fresh_disposable_database_removed_after_probe',migrations:result.rows[0].migrations,permissions,boundaries,providerCalls:0,physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');
  }
  const receipt = {environment: 'local_disposable_fixture', migrations: result.rows[0].migrations, providerCalls: 0, freshDatabase: fresh, physicalTesting: 'deferred_by_user_2026-10-16'};
  if (fresh) await writeFile('.omp/work/flutter-delivery-20261016/evidence/p1-fresh-migrations.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  await db.end();
  if (control && freshName) {
    try { await control.query(`DROP DATABASE "${freshName}"`); }
    finally { await control.end(); }
  }
}
