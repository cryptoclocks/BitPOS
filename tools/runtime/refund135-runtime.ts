// Owned local clone only. Synthetic login/payment evidence; no RPC or transfers.
import pg from 'pg';import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {createServer} from 'node:http';
import {createRefundSqlTransaction,createFoodRefundSqlStore} from '../../apps/worker/src/food-refund-store';
import {build} from '../../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js';
import {fixturePaymentAttempt} from '../../tests/backend-payment-fixture';
import {Keypair} from '@solana/web3.js';
const terminal=process.argv.includes('--terminal'),exec=promisify(execFile),name='bitpos_refund_commit_'+randomUUID().replaceAll('-','').slice(0,12),bin='/opt/homebrew/opt/postgresql@17/bin',directory=await mkdtemp(join(tmpdir(),'bitpos-refund135-')),role='bitpos_refund110_fixture';
const admin=new pg.Client({host:'127.0.0.1',port:55446,database:'bitpos_w01_fixture'});await admin.connect();
let created=false,ownedRole=false,db:pg.Client|undefined,api:ReturnType<typeof spawn>|undefined,server:ReturnType<typeof createServer>|undefined;
const stamp=new Date().toISOString().replaceAll(':','-'),evidence='.omp/work/flutter-delivery-20261016/evidence/w02-refund135-runtime-'+stamp+'.json';
const lateRefresh=process.argv.includes('--late-refresh');assert.ok(!lateRefresh||terminal,'Late refresh requires terminal selected fixture');
try{
 assert.equal((await admin.query('SELECT current_database() n')).rows[0].n,'bitpos_w01_fixture');
 assert.equal((await admin.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0,'Never reuse another owner role');
 await exec(bin+'/pg_dump',['-h','127.0.0.1','-p','55446','-d','bitpos_w01_fixture','-Fc','-f',join(directory,'fixture.dump')]);await admin.query('CREATE DATABASE '+name);created=true;
 await exec(bin+'/pg_restore',['-h','127.0.0.1','-p','55446','-d',name,'--no-owner','--disable-triggers','--exit-on-error',join(directory,'fixture.dump')],{maxBuffer:1024*1024});
 const seed=await exec('pnpm',['exec','tsx','tools/runtime/food-return108-sql-smoke.ts','--finance','--journal','--wallet-journal','--funding','--ledger','--fees','--submission','--fee-costs','--execution-read','--customer-execution','--late-reconcile','--selected-line',...(terminal?['--selected-execution','--commit-finalized']:['--commit-before-decision'])],{env:{...process.env,BITPOS_REFUND_COMMIT_CLONE:name},maxBuffer:1024*1024});
 assert.ok(seed.stdout.includes('COMMITTED_PRIVATE_REFUND_FIXTURE_READY'));ownedRole=terminal;
 db=new pg.Client({host:'127.0.0.1',port:55446,database:name});await db.connect();
 const record=(await db.query('SELECT r.case_id,r.merchant_id,r.order_id,c.assignment_id FROM bitpos.food_return108_financial_reviews r JOIN bitpos.food_return108_cases c ON c.id=r.case_id')).rows[0];
 if(process.argv.includes('--decision-race')){
  assert.equal(terminal,false,'Decision race requires undecided fixture');
  const race=await exec('pnpm',['exec','tsx','tools/runtime/refund135-allocation-concurrency.ts',name],{maxBuffer:1024*1024});console.log(race.stdout);
  await writeFile(evidence,JSON.stringify({status:'PASS_CANONICAL_DECISION_RACE_OWNED_CLONE',proofReceipt:race.stdout.trim(),limits:['Canonical selected versus full decision only; intrinsic cross-lane allocator race not covered'],cleanup:'Owned clone/dump removed in finally'},null,2)+'\n');
 }else{
 let replayProof:unknown=null;
 if(terminal){
  await db.query('ALTER ROLE '+role+' LOGIN');
  const fact=(await db.query("SELECT attempt_id,evidence,verification_hash,posting_id FROM bitpos.food_refund112_receipts WHERE outcome='FINALIZED'")).rows[0];
  const before=(await db.query('SELECT count(*)::int receipts FROM bitpos.food_refund112_receipts')).rows[0];
  let firstHash:string|undefined;
  for(let cycle=0;cycle<2;cycle++){
   const pool=new pg.Pool({host:'127.0.0.1',port:55446,database:name,user:role,max:2});
   try{
    const tx=createRefundSqlTransaction(pool),store=createFoodRefundSqlStore(tx,{receipts:'112',submission:'114'}),snapshot=await store.snapshot(fact.attempt_id);
    const replies=await Promise.all([1,2].map(()=>tx(async client=>(await client.query('SELECT bitpos.food_refund112_record($1,$2,$3::jsonb,$4) value',[fact.attempt_id,'FINALIZED',JSON.stringify(fact.evidence),fact.verification_hash])).rows[0].value)));
    assert.deepEqual(replies[0],replies[1]);assert.equal(replies[0].quarantined,false);assert.equal(replies[0].postingId,fact.posting_id);
    assert.equal(snapshot.state,'FINALIZED');assert.equal(snapshot.fundingAvailable,false);await assert.rejects(store.authorizeSubmission(snapshot),/REFUND_SUBMISSION_NOT_READY/);
    if(cycle===0)firstHash=snapshot.prepared?.signedBytesSha256;else assert.equal(snapshot.prepared?.signedBytesSha256,firstHash);
   }finally{await pool.end();}
  }
  assert.deepEqual((await db.query('SELECT count(*)::int receipts FROM bitpos.food_refund112_receipts')).rows[0],before);
  const ledger=(await db.query('SELECT sum(debit_minor)::text debit,sum(credit_minor)::text credit FROM bitpos.ledger_entries WHERE transaction_id=$1',[fact.posting_id])).rows[0];
  assert.equal(ledger.debit,fact.evidence.amountMinor);assert.equal(ledger.credit,fact.evidence.amountMinor);
  replayProof={independentReplayTransactions:4,poolLifecycles:2,receiptCountUnchanged:true,terminalSubmissionRefused:true,ledger,preparedHashUnchanged:true};
 }
 const actor=randomUUID(),session=randomUUID(),token=randomBytes(32).toString('base64url'),grant=randomUUID();
 await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject)VALUES($1,$1)',[actor]);
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,actor,randomUUID(),createHash('sha256').update(token).digest('hex'),createHash('sha256').update(randomUUID()).digest('hex')]);
 await db.query("INSERT INTO bitpos.platform_staff_role_grants(id,account_id,role,granted_by,expires_at)VALUES($1,$2,'administrator','135 disposable runtime fixture',clock_timestamp()+interval '1 hour')",[grant,actor]);await db.query('INSERT INTO bitpos.platform_role_scopes VALUES($1,$2)',[grant,record.merchant_id]);
 await db.query('GRANT EXECUTE ON FUNCTION bitpos.food_refund116_execution(uuid),bitpos.food_return109_snapshot(uuid),bitpos.food_return109_decide(uuid,jsonb),bitpos.food_refund119_reconcile(uuid,jsonb)TO bitpos_app');
 const staffSession={accountId:actor,sessionId:session,accessToken:token,refreshToken:randomBytes(32).toString('base64url'),accessExpiresAt:new Date(Date.now()+3600000).toISOString(),refreshExpiresAt:new Date(Date.now()+7200000).toISOString()};
 const avd=process.argv.includes('--avd');if(avd&&!terminal)throw Error('AVD selected finality requires --terminal');
 let customerSessionId:string|undefined,avdRevoked=false;
 if(avd){
  const account=(await db.query('SELECT s.account_id FROM bitpos.food_return108_cases c JOIN bitpos.food_shipments s ON s.id=c.shipment_id WHERE c.id=$1',[record.case_id])).rows[0].account_id;
  // Prior smoke cleanup disables this synthetic buyer in the base fixture.
  // Activate only the owned disposable clone; never change the base account.
  assert.equal((await db.query('SELECT current_database() name')).rows[0].name,name);
  await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=NULL WHERE id=$1',[account]);
  customerSessionId=randomUUID();const customerToken=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url');
  await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[customerSessionId,account,randomUUID(),createHash('sha256').update(customerToken).digest('hex'),createHash('sha256').update(refresh).digest('hex')]);
  await db.query('GRANT EXECUTE ON FUNCTION bitpos.food_refund117_customer(uuid)TO bitpos_app');
  const mobileSession={accountId:account,sessionId:customerSessionId,accessToken:customerToken,refreshToken:refresh,accessExpiresAt:staffSession.accessExpiresAt,refreshExpiresAt:staffSession.refreshExpiresAt};
  const config=join(directory,'avd.json');await writeFile(config,JSON.stringify({BITPOS_FIXTURE:true,BITPOS_TEST_SELECTED_REFUND:true,BITPOS_TEST_ORDER_ID:record.order_id,BITPOS_TEST_SESSION_BASE64:Buffer.from(JSON.stringify(mobileSession)).toString('base64'),BITPOS_MOBILE_API:'http://127.0.0.1:3048/api/mobile/v1/'}),{mode:0o600});
  console.log('REFUND135_AVD_CONFIG '+config);
 }
 const source=`import React from 'react';import{createRoot}from'react-dom/client';import FoodReturnFinancialPanel from './apps/web/src/components/FoodReturnFinancialPanel.tsx';import{FoodReturnSession}from './apps/web/src/lib/food-return-session.ts';import './apps/web/src/styles/platform.css';const f=await(await fetch('/bootstrap')).json();const service=new FoodReturnSession();await service.verify('+66900000002','123456');createRoot(document.getElementById('root')).render(<main className="platform"><h1>Selected refund · local payment fixture</h1><FoodReturnFinancialPanel service={service} caseId={f.caseId} thai={new URLSearchParams(location.search).get('lang')==='th'} disabled={false}/></main>);`;
 const bundle=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'/tmp/bitpos-refund135-bundle',format:'esm',jsx:'automatic'});
 const jsFile=bundle.outputFiles?.find(f=>f.path.endsWith('.js')),cssFile=bundle.outputFiles?.find(f=>f.path.endsWith('.css'));
 if(!jsFile||!cssFile)throw Error('Product panel JavaScript/CSS bundle missing');
 const js=jsFile.text,css=cssFile.text;
 api=spawn('pnpm',['exec','tsx','tools/runtime/fixture/return-clone-api.ts'],{env:{...process.env,BITPOS_RETURN_CLONE_NAME:name,BITPOS_RETURN_TEST_FINANCE:'1',BITPOS_RETURN_TEST_EXECUTION:'1',BITPOS_RETURN_TEST_RECONCILE:'1'},stdio:['ignore','pipe','pipe'],detached:true});let output='';api.stdout!.on('data',b=>{output=(output+b.toString()).slice(-4000);});api.stderr!.on('data',b=>{output=(output+b.toString()).slice(-4000);});
 const deadline=Date.now()+30000;while(!output.includes('RETURN_CLONE_API_READY')){if(api.exitCode!==null||Date.now()>deadline)throw Error('Owned API did not become ready');await new Promise(r=>setTimeout(r,100));}
 let finish!:()=>void;const finished=new Promise<void>(resolve=>{finish=resolve;});let lostResponse=false;const posts:unknown[]=[];
 let lateInserted=false;
 server=createServer(async(req,res)=>{try{
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');return res.end(js);}
  if(req.url==='/bootstrap'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({caseId:record.case_id}));}
  if(req.url==='/api/mobile/v1/auth/verify'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(staffSession));}
  if(req.url==='/finish'&&req.method==='POST'){res.end('{}');finish();return;}
  if(req.url==='/late-fixture'&&req.method==='POST'&&lateRefresh){
   assert.equal(lateInserted,false);assert.equal((await db!.query('SELECT current_database() n')).rows[0].n,name);
   await db!.query('BEGIN');try{
    await db!.query('SET LOCAL search_path=bitpos,public');await db!.query("SELECT set_config('bitpos.merchant',$1,true)",[record.merchant_id]);
    const signature='SQL-LATE-REFRESH-FIXTURE-'+randomUUID(),attempt=(await fixturePaymentAttempt(db!,{merchant:record.merchant_id,order:record.order_id,status:'SUBMITTED',signature,payer:Keypair.generate().publicKey.toBase58()})).rows[0];
    await db!.query("INSERT INTO payments(merchant_id,order_id,attempt_id,signature,amount_minor,state)VALUES($1,$2,$3,$4,$5,'RECOVERY')",[record.merchant_id,record.order_id,attempt.id,signature,attempt.amount_minor]);await db!.query('COMMIT');lateInserted=true;
   }catch(error){await db!.query('ROLLBACK');throw error;}
   res.setHeader('Content-Type','application/json');res.end('{"syntheticLateRecoveryInserted":true}');return;
  }
  if(req.url==='/revoke-customer'&&req.method==='POST'&&avd&&customerSessionId){await db!.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp()WHERE id=$1',[customerSessionId]);avdRevoked=true;res.end('{}');return;}
  if(req.url?.startsWith('/api/')){const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const response=await fetch('http://127.0.0.1:3048'+req.url,{method:req.method,headers:{'Content-Type':'application/json',...(req.headers.authorization?{Authorization:req.headers.authorization}:{})},body:body.length?body:undefined});const text=await response.text();if(req.method==='POST'&&req.url.endsWith('/financial-review')){posts.push(JSON.parse(body.toString()));if(response.ok&&!lostResponse){lostResponse=true;res.statusCode=503;res.setHeader('Content-Type','application/json');return res.end('{}');}}res.statusCode=response.status;res.setHeader('Content-Type','application/json');return res.end(text);}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>'+css+'</style><div id="root"></div><script type="module" src="/app.js"></script></html>');
 }catch{res.statusCode=502;res.end('{}');}});
 await new Promise<void>(resolve=>server!.listen(4423,'127.0.0.1',resolve));console.log('REFUND135_UI_READY http://127.0.0.1:4423 '+(terminal?'SELECTED_FINALIZED':'AWAITING_SELECTION'));
 await finished;
 if(avd)assert.equal(avdRevoked,true,'AVD must exercise live session revocation before fixture finish');
 const decision=(await db.query('SELECT receipt FROM bitpos.food_return109_decisions WHERE case_id=$1',[record.case_id])).rows[0].receipt;assert.equal(decision.decision,'LINE_REFUND');
 const amounts=(await db.query('SELECT a.amount_minor::text allocated,p.amount_minor::text received FROM bitpos.food_return109_allocations a JOIN bitpos.payments p ON p.id=a.payment_id WHERE a.case_id=$1',[record.case_id])).rows;assert.equal(amounts.length,1);assert.equal(amounts[0].allocated,decision.selection.refundAmount.amountMinor);assert.ok(BigInt(amounts[0].allocated)<BigInt(amounts[0].received));
 if(!terminal){assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(lostResponse,true);}
 const execution=(await db.query('SELECT bitpos.food_refund117_safe_execution($1) value',[record.case_id])).rows[0].value;assert.equal(execution.state,lateRefresh?'RECONCILIATION_REQUIRED':terminal?'SELECTED_FINALIZED':'PENDING');if(lateRefresh)assert.equal(lateInserted,true);assert.equal(execution.allPaymentsRefunded,false);assert.deepEqual(execution.selectedRefund,decision.selection);
 const files=['supabase/migrations/135_food_selected_line_refunds.sql','tools/runtime/refund135-runtime.ts','apps/web/src/components/FoodReturnFinancialPanel.tsx','apps/web/src/lib/food-return-session.ts','apps/api/src/food-return-candidate.ts'];
 await writeFile(evidence,JSON.stringify({status:terminal?'PASS_COMMITTED_SELECTED_FINALITY_API_PANEL':'PASS_SELECTED_LINE_BROWSER_COMMAND_LOSS_RELOAD_EXACT_REPLAY',checkedAtUtc:new Date().toISOString(),execution,amounts,replayProof,commandCount:posts.length,exactRecovery:!terminal,sourceSha256:Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')]))),limits:['Synthetic login and original payment; offline provider only; no real funds or chain','Browser interactions separately observed by parent; not full route/pixel acceptance'],physicalTesting:'deferred_by_user_2026-10-16',cleanup:'Owned API/UI stopped; owned clone, fixture role and dump removed in finally'},null,2)+'\n');console.log('REFUND135_RUNTIME_PASS '+evidence);
 }
}catch(error){await writeFile(evidence,JSON.stringify({status:'FAIL_RETAINED',checkedAtUtc:new Date().toISOString(),message:error instanceof Error?error.message:'Unknown failure'},null,2)+'\n');throw error;}
finally{
 if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
 if(api&&api.exitCode===null){const stopped=new Promise<void>(resolve=>api!.once('exit',()=>resolve()));process.kill(-api.pid!,'SIGTERM');await stopped;}
 if(created){if(!db){db=new pg.Client({host:'127.0.0.1',port:55446,database:name});await db.connect();}if(ownedRole){await db.query('DROP OWNED BY '+role);await db.query('DROP ROLE '+role);}await db.end();await admin.query('DROP DATABASE '+name);}
 await admin.end();await rm(directory,{recursive:true,force:true});
}
