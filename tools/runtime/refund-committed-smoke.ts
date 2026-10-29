import pg from 'pg';import assert from 'node:assert/strict';import{randomUUID,randomBytes,createHash}from'node:crypto';import{mkdtemp,readFile,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{execFile,spawn}from'node:child_process';import{promisify}from'node:util';
import{createRefundSqlTransaction,createFoodRefundSqlStore}from'../../apps/worker/src/food-refund-store';
const terminalFinal=process.argv.includes('--terminal-final'),terminalBrowser=process.argv.includes('--terminal-browser')||terminalFinal;
const processCrash=process.argv.includes('--process-crash'),submissionRace=process.argv.includes('--submission-race')||processCrash;
const exec=promisify(execFile),name='bitpos_refund_commit_'+randomUUID().replaceAll('-','').slice(0,12),bin='/opt/homebrew/opt/postgresql@17/bin',directory=await mkdtemp(join(tmpdir(),'bitpos-refund-commit-')),role='bitpos_refund110_fixture';
const admin=new pg.Client({host:'127.0.0.1',port:55446,database:'bitpos_w01_fixture'});await admin.connect();let created=false,ownedRole=false,db:pg.Client|undefined;
try{
 assert.equal((await admin.query('SELECT current_database() n')).rows[0].n,'bitpos_w01_fixture');assert.equal((await admin.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0,'Never reuse another test owner role');
 await exec(bin+'/pg_dump',['-h','127.0.0.1','-p','55446','-d','bitpos_w01_fixture','-Fc','-f',join(directory,'fixture.dump')]);await admin.query('CREATE DATABASE '+name);created=true;
 await exec(bin+'/pg_restore',['-h','127.0.0.1','-p','55446','-d',name,'--no-owner','--disable-triggers','--exit-on-error',join(directory,'fixture.dump')],{maxBuffer:1024*1024});
 const result=await exec('pnpm',['exec','tsx','tools/runtime/food-return108-sql-smoke.ts','--finance','--journal','--wallet-journal','--funding','--ledger','--fees','--submission','--fee-costs',...(terminalBrowser?['--execution-read']:[]),...(terminalFinal?['--commit-finalized']:[]),...(submissionRace?['--commit-before-submit']:[])],{env:{...process.env,BITPOS_REFUND_COMMIT_CLONE:name},maxBuffer:1024*1024});assert.ok(result.stdout.includes('COMMITTED_PRIVATE_REFUND_FIXTURE_READY'));ownedRole=true;
 db=new pg.Client({host:'127.0.0.1',port:55446,database:name});await db.connect();await db.query('ALTER ROLE '+role+' LOGIN');
 if(submissionRace){
  const item=(await db.query('SELECT id FROM bitpos.food_refund110_attempts')).rows;assert.equal(item.length,1);const attempt=item[0].id;
  let priorSubmissions=0,crashEvidence:unknown=null;
  if(processCrash){
   let exitOutput='';
   try{await exec('pnpm',['exec','tsx','tools/runtime/refund-crash-child.ts',name,attempt,'exit-after-send'],{maxBuffer:1024*1024});assert.fail('Child must exit86');}
   catch(error){const result=error as Error&{code?:number;stdout?:string};assert.equal(result.code,86);exitOutput=result.stdout??'';}
   const crashed=JSON.parse(exitOutput.trim().split('\n').find(v=>v.startsWith('{'))!);assert.equal(crashed.event,'OFFLINE_SEND_OBSERVED');
   assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_refund114_submissions')).rows[0].n,1);
   const recovered=await exec('pnpm',['exec','tsx','tools/runtime/refund-crash-child.ts',name,attempt,'recover'],{maxBuffer:1024*1024});assert.ok(recovered.stdout.includes('RECOVERED_EXACT_ORIGINAL_ATTEMPT'));
   const replay=JSON.parse(recovered.stdout.trim().split('\n').find(v=>v.startsWith('{'))!);assert.deepEqual(replay,crashed);
   assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_refund114_submissions')).rows[0].n,2);
   assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_refund112_receipts')).rows[0].n,0);
   crashEvidence={childExit:86,sendBeforeExit:crashed,exactRecovery:true,provider:'offline synthetic transport; no real broadcast'};priorSubmissions=2;
  }
  const pool=new pg.Pool({host:'127.0.0.1',port:55446,database:name,user:role,max:2});
  try{
   const store=createFoodRefundSqlStore(createRefundSqlTransaction(pool),{receipts:'112',submission:'114'}),snapshot=await store.snapshot(attempt);assert.equal(snapshot.fundingAvailable,true);assert.equal(snapshot.state,'UNKNOWN');
   const replies=await Promise.all([store.authorizeSubmission(snapshot),store.authorizeSubmission(snapshot)]);assert.equal(replies.filter(Boolean).length,1);assert.equal(replies.filter(v=>v===null).length,1);
   assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_refund114_submissions')).rows[0].n,priorSubmissions+1);
   const next=await store.snapshot(attempt);assert.equal(next.prepared?.signedBase64,snapshot.prepared?.signedBase64);assert.equal(next.version,String(BigInt(snapshot.version)+1n));
  }finally{await pool.end();}
  const freshPool=new pg.Pool({host:'127.0.0.1',port:55446,database:name,user:role,max:1});try{
   const store=createFoodRefundSqlStore(createRefundSqlTransaction(freshPool),{receipts:'112',submission:'114'}),snapshot=await store.snapshot(attempt);assert.equal(snapshot.state,'UNKNOWN');assert.equal(snapshot.fundingAvailable,true);assert.ok(snapshot.prepared);
   const ready=await store.authorizeSubmission(snapshot);assert.equal(ready?.prepared?.signedBase64,snapshot.prepared?.signedBase64);assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_refund114_submissions')).rows[0].n,priorSubmissions+2);
  }finally{await freshPool.end();}
  const files=['tools/runtime/refund-committed-smoke.ts','supabase/migrations/114_food_refund_submission.sql','apps/worker/src/food-refund-store.ts','tools/runtime/refund-crash-child.ts'];
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+(processCrash?'w02-refund-process-crash-20261021.json':'w02-refund-committed-submission-race-20261021.json'),JSON.stringify({status:processCrash?'PASS_COMMITTED_PROCESS_EXIT_EXACT_RECOVERY':'PASS_COMMITTED_SUBMISSION_CAS_AND_RECONNECT',crashEvidence,checkedAtUtc:new Date().toISOString(),checks:['Prepared attempt/token+fee reservations committed on private clone before submission','Two independent committed transactions with same expectedVersion: exactly1admitted/1CASnull and exactly1additional submissionrow','Pool closed and reopened: UNKNOWN signed bytes unchanged; exact-byte retry admission creates exactly1additional submissionrow without replacement'],sourceSha256:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')]))),limits:[processCrash?'Own worker child exits86 after offline transport observation; no real network/provider, no OS/DB restart':'No provider call or broadcast; connectionpool recovery only, not mid-send process death','Parallel committed CAS calls; not a measured lock-contention ordering test'],cleanup:'Private clone/dump/owned role removed in finally'},null,2)+'\n');console.log(processCrash?'PASS_COMMITTED_PROCESS_EXIT_EXACT_RECOVERY':'PASS_COMMITTED_SUBMISSION_CAS_AND_RECONNECT');
 }else{
 const facts=(await db.query('SELECT a.id,r.outcome,r.evidence,r.verification_hash FROM bitpos.food_refund110_attempts a JOIN bitpos.food_refund112_receipts r ON r.attempt_id=a.id WHERE r.outcome=\'FINALIZED\'')).rows;assert.equal(facts.length,1);const item=facts[0];
 const before=(await db.query("SELECT (SELECT count(*)::int FROM bitpos.food_refund112_receipts) receipts,(SELECT count(*)::int FROM bitpos.food_refund115_costs) costs,(SELECT count(*)::int FROM bitpos.ledger_transactions WHERE source_kind LIKE 'FOOD_REFUND_%') postings")).rows[0];assert.equal(before.receipts,terminalFinal?1:2);assert.equal(before.costs,1);
 async function connectionCycle(){const pool=new pg.Pool({host:'127.0.0.1',port:55446,database:name,user:role,max:2});try{
  const tx=createRefundSqlTransaction(pool),store=createFoodRefundSqlStore(tx,{receipts:'112',submission:'114'});const snapshot=await store.snapshot(item.id);assert.equal(snapshot.state,'FINALIZED');assert.equal(snapshot.fundingAvailable,false);
  // Actual independent transactions race exact receipt replays after fixture commit.
  const replies=await Promise.all([1,2].map(()=>tx(async client=>(await client.query('SELECT bitpos.food_refund112_record($1,$2,$3::jsonb,$4) value',[item.id,item.outcome,JSON.stringify(item.evidence),item.verification_hash])).rows[0].value)));
  assert.deepEqual(replies[0],replies[1]);assert.equal(replies[0].quarantined,!terminalFinal);
  await assert.rejects(store.authorizeSubmission(snapshot),/REFUND_SUBMISSION_NOT_READY/);return snapshot.prepared?.signedBytesSha256;
 }finally{await pool.end();}}
 const first=await connectionCycle(),second=await connectionCycle();assert.equal(first,second);
 if(terminalBrowser){
  const actor=randomUUID(),session=randomUUID(),token=randomBytes(32).toString('base64url'),grant=randomUUID(),merchant=(await db.query('SELECT merchant_id FROM bitpos.food_return108_financial_reviews')).rows[0].merchant_id,caseId=(await db.query('SELECT case_id FROM bitpos.food_return109_decisions')).rows[0].case_id;
  await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject)VALUES($1,$1)',[actor]);await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,actor,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomUUID()).digest('hex')]);
  await db.query("INSERT INTO bitpos.platform_staff_role_grants(id,account_id,role,granted_by,expires_at)VALUES($1,$2,'administrator','Committed terminal browser fixture',clock_timestamp()+interval '1 hour')",[grant,actor]);await db.query('INSERT INTO bitpos.platform_role_scopes VALUES($1,$2)',[grant,merchant]);await db.query('GRANT EXECUTE ON FUNCTION bitpos.food_refund116_execution(uuid),bitpos.food_return109_snapshot(uuid)TO bitpos_app');
  const api=spawn('pnpm',['exec','tsx','tools/runtime/fixture/return-clone-api.ts'],{env:{...process.env,BITPOS_RETURN_CLONE_NAME:name,BITPOS_RETURN_TEST_FINANCE:'1',BITPOS_RETURN_TEST_EXECUTION:'1'},stdio:['ignore','pipe','pipe'],detached:true});let output='';api.stdout!.on('data',b=>{output=(output+b.toString()).slice(-4000);});api.stderr!.on('data',b=>{output=(output+b.toString()).slice(-4000);});
  try{
   const deadline=Date.now()+30000;while(!output.includes('RETURN_CLONE_API_READY')){if(api.exitCode!==null||Date.now()>deadline)throw Error('Private terminal API unavailable');await new Promise(r=>setTimeout(r,100));}
   // @ts-expect-error Local browser harness has no declaration file.
   const {verifyReturnBrowser}=await import('./food-return-browser.mjs');const proof=await verifyReturnBrowser({financialOnly:true,executionTerminal:true,executionFinalized:terminalFinal,caseId,staffSession:{accountId:actor,sessionId:session,accessToken:token,refreshToken:randomBytes(32).toString('base64url'),accessExpiresAt:new Date(Date.now()+3600000).toISOString(),refreshExpiresAt:new Date(Date.now()+7200000).toISOString()}},async()=>{});
   await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+(terminalFinal?'w02-refund116-committed-final-browser-20261021.json':'w02-refund116-committed-dispute-browser-20261021.json'),JSON.stringify({status:terminalFinal?'PASS_COMMITTED_FINALIZED_PROJECTION_BROWSER':'PASS_COMMITTED_DISPUTE_PROJECTION_BROWSER',checkedAtUtc:new Date().toISOString(),proof,limits:['Actual committed receipts/ledger read through actual enabled API/product panel; synthetic seeded login and offline chain fixture','No real chain/funds; no full platform route or pixel acceptance'],cleanup:'Owned API stopped, clone/dump/role removed by owner'},null,2)+'\n');
  }finally{if(api.exitCode===null){const exited=new Promise<void>(resolve=>api.once('exit',()=>resolve()));process.kill(-api.pid!,'SIGTERM');await exited;}}
 }

 const after=(await db.query("SELECT (SELECT count(*)::int FROM bitpos.food_refund112_receipts) receipts,(SELECT count(*)::int FROM bitpos.food_refund115_costs) costs,(SELECT count(*)::int FROM bitpos.ledger_transactions WHERE source_kind LIKE 'FOOD_REFUND_%') postings")).rows[0];assert.deepEqual(after,before);
 const files=['tools/runtime/refund-committed-smoke.ts','tools/runtime/food-return108-sql-smoke.ts','apps/worker/src/food-refund-store.ts'];
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+(terminalFinal?'w02-refund-finalized-committed-reconnect-20261021.json':'w02-refund-committed-reconnect-20261021.json'),JSON.stringify({status:'PASS_DISPOSABLE_COMMITTED_REFUND_RECONNECT_REPLAY',checkedAtUtc:new Date().toISOString(),before,after,checks:['108–115 fixture DDL+operations committed only on private fullschema clone','Restricted login uses production transaction factory and real commit per call','Two separate transactions replay exact terminal receipt concurrently; repeated with newly opened pool','Terminal readiness false and submission refused; persisted signed hash unchanged','Receipt/cost/ledger counts unchanged after replay and pool close/reopen'],sourceSha256:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')]))),limits:['Offline signed synthetic RPC/provider; no real payments/transfers','Connection/pool restart only, not OS/database restart or mid-submission process crash','Concurrent terminal replay only; first funding/prepare/submit race still required'],cleanup:'Private clone/dump/fixture role removed in finally'},null,2)+'\n');console.log('PASS_COMMITTED_REFUND_RECONNECT_REPLAY');
 }
}finally{
 if(created){if(!db){db=new pg.Client({host:'127.0.0.1',port:55446,database:name});await db.connect();}if(ownedRole){await db.query('DROP OWNED BY '+role);await db.query('DROP ROLE '+role);}await db.end();await admin.query('DROP DATABASE '+name);}
 await admin.end();await rm(directory,{recursive:true,force:true});
}
