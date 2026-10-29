import {readFile,writeFile,unlink,rm} from 'node:fs/promises';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';
import pg from 'pg';
// Preserve isolated proposed source. Stage one instrumented temporary copy of
// its real factory scenario; no installed runtime or actual-use schema changes.
const dir='/tmp/bitpos-scheduled086-20261017',path=dir+'/deadline_probe.ts';let source=await readFile(dir+'/release_options_smoke.ts','utf8');
source=source.replaceAll('bitpos_delivery_fixture','bitpos_schedule086_fixture');
const before=process.argv.includes('--finish')?"  const final=(await db.query('SELECT schedule086_finish_bill":"  const frozen=(await db.query<QuoteRow>('SELECT * FROM order_quotes WHERE merchant_id=$1 AND id=$2',[f.merchant_id,quote])).rows[0];";
assert.ok(source.includes(before));source=source.replace(before,"  await db.query(\"SELECT pg_sleep(greatest(0,extract(epoch FROM commitment_until-clock_timestamp()))+0.05) FROM schedule086_intents WHERE id=$1\",[intent.intentId]);\n  assert.equal((await db.query('SELECT commitment_until<=clock_timestamp() expired FROM schedule086_intents WHERE id=$1',[intent.intentId])).rows[0].expired,true);\n"+before);
source=source.replace("receipt.status='PASS_bounded_fixed_option_version_commitment_only'","receipt.status='REPRO_LATE_CANONICAL_ADMISSION_AFTER_REAL_DEADLINE'").replace("dir+'/release-options-smoke-receipt.json'","dir+'/deadline-probe-receipt.json'");
await writeFile(path,source,{flag:'wx'});
const observer=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_schedule086_fixture'});await observer.connect();
const counterpart=async()=> (await observer.query("SELECT (SELECT count(*)::text FROM bitpos.orders) orders,(SELECT count(*)::text FROM bitpos.order_authority) authorities,(SELECT count(*)::text FROM bitpos.order_submissions) submissions,(SELECT coalesce(jsonb_agg(jsonb_build_array(id,stock,reserved) ORDER BY id),'[]') FROM bitpos.products) products,to_regclass('bitpos.schedule086_intents')::text intents")).rows[0];
const baseline=await counterpart();
try{
 await rm(dir+'/deadline-probe-receipt.json',{force:true});
 const child=spawn('npx',['--no-install','tsx',path],{stdio:'inherit'});const [code]=await once(child,'exit');
 const receipt=JSON.parse(await readFile(dir+'/deadline-probe-receipt.json','utf8'));
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/schedule086-deadline-last-child-20261019.json',JSON.stringify({exitCode:code,...receipt,physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');
 assert.deepEqual(await counterpart(),baseline,'Canonical orders, stock and scheduling schema must match pre-transaction state after rollback');
 receipt.persistedCounterpartUnchanged=true;
 if(process.argv.includes('--expect-fenced')){
  assert.equal(code,1);assert.equal(receipt.error,'error: SCHEDULE_COMMITMENT_EXPIRED');assert.equal(receipt.sqlstate,'23514');assert.equal(receipt.cleanup,true);
  receipt.status='PASS_REAL_DEADLINE_CANONICAL_ADMISSION_FENCED_ROLLBACK';
 }else assert.equal(code,0,'Counterexample setup/factory failed; inspect receipt, do not infer deadline closure');
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/schedule086-deadline-'+(process.argv.includes('--finish')?'finish-':'')+'probe-20261019.json',JSON.stringify({exitCode:code,...receipt,physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');
 console.log(JSON.stringify(receipt));
}finally{await observer.end();await unlink(path);}
