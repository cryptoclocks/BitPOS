// Real Solana-devnet food refund through the product's own refund pipeline (migrations 108-114, 116).
// Disposable local database only. Keys are read from the private directory in this process and never printed.
// The ORDER and its original payment are SYNTHETIC fixture rows; the payer on that order is re-pointed to the
// customer-alice test wallet so the refund lands somewhere we control. Everything after that is the real path:
// return case -> merchant receipt -> resolution -> finance FULL_REFUND decision (allocation) -> verified inbound
// USDG funding + verified native fee credit -> exclusive reservations -> prepare/sign/authorize/broadcast ->
// finalized chain verification -> receipt ledger. No client callback marks anything refunded.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import {createFoodRefundFunding} from '../../apps/worker/src/food-refund-funding';
import {createRefundFeeFunding} from '../../apps/worker/src/refund-fee-funding';
import {createRefundFeeVerifier} from '../../apps/worker/src/refund-fee-verifier';
import {createFoodRefundSqlStore,createRefundSqlTransaction} from '../../apps/worker/src/food-refund-store';
import {executeFoodRefundAttempt} from '../../apps/worker/src/food-refund-execution';
import {createPayoutProvider} from '../../apps/worker/src/payout-provider';
import {createFoodRefundWorker} from '../../apps/worker/src/food-refund-runtime';
import {prepareFoodReturnCandidate,recordFoodReturnCandidate,resolveFoodReturnCandidate} from '../../apps/api/src/food-return-candidate';
import {USDG_ASSET} from '../../packages/domain/src/payment-assets';

const RPC='https://api.devnet.solana.com',DEVNET_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const ASSIGNMENT=process.env.BITPOS_REFUND_ASSIGNMENT??'8ad9af34-fb2a-4d79-bfb2-a82e195cb78a';
const keyDir=process.env.BITPOS_DEVNET_KEY_DIR??join(homedir(),'Desktop','BitPOS-Devnet-Private','keys');
const key=(role:string)=>Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(keyDir,role+'.json'),'utf8'))));
const customer=key('customer-alice'),sender=key('merchant-a-treasury'),sponsor=key('fee-sponsor'),reserve=key('reserve');
const connection=new Connection(RPC,'confirmed'),finalized=new Connection(RPC,'finalized');
const mint=new PublicKey(USDG_ASSET.mint),program=new PublicKey(USDG_ASSET.tokenProgram);
const ata=(owner:PublicKey)=>spl.getAssociatedTokenAddressSync(mint,owner,false,program);
const usdg=async(owner:PublicKey)=>Number((await connection.getTokenAccountBalance(ata(owner))).value.amount)/1e6;
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const step=(name:string,detail:unknown='')=>console.log('STEP',name,typeof detail==='string'?detail:JSON.stringify(detail));
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
async function finalize(signed:Transaction,payer:Keypair){
 const latest=await connection.getLatestBlockhash('finalized');signed.feePayer=payer.publicKey;signed.recentBlockhash=latest.blockhash;signed.sign(payer);
 const signature=await connection.sendRawTransaction(signed.serialize(),{skipPreflight:false});
 await connection.confirmTransaction({signature,...latest},'finalized');return signature;
}
const db=new pg.Client({host:'127.0.0.1',port:55440,database:'bitpos_delivery_fixture'});
await db.connect();
const role='bitpos_refund110_fixture';
let pool:pg.Pool|undefined;
const result:Record<string,unknown>={};
try{
 assert.equal(await connection.getGenesisHash(),DEVNET_GENESIS,'Unexpected cluster');
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const before={customer:await usdg(customer.publicKey),treasury:await usdg(sender.publicKey),reserve:await usdg(reserve.publicKey),reserveSol:(await connection.getBalance(reserve.publicKey))/1e9};
 step('balances before',before);
 await db.query('SET search_path=bitpos,public');

 // 0. Fixture preparation (synthetic order): payer evidence is immutable, so re-point it with triggers off on this disposable database only.
 let row=(await db.query('SELECT a.*,s.merchant_id,s.order_id,s.version shipment_version FROM food_assignments a JOIN food_shipments s ON s.id=a.shipment_id WHERE a.id=$1',[ASSIGNMENT])).rows[0];
 assert.ok(row&&row.state==='PICKED_UP','Fixture assignment must be PICKED_UP');
 assert.equal((await db.query('SELECT count(*)::int n FROM food_return108_cases WHERE assignment_id=$1',[ASSIGNMENT])).rows[0].n,0,'Assignment already has a return case');
 await db.query('BEGIN');await db.query("SET LOCAL session_replication_role='replica'");
 await db.query('UPDATE payment_attempt_assets SET payer=$2 WHERE order_id=$1',[row.order_id,customer.publicKey.toBase58()]);
 await db.query('UPDATE payment_attempts SET payer=$2 WHERE order_id=$1',[row.order_id,customer.publicKey.toBase58()]);
 await db.query('COMMIT');step('fixture payer re-pointed',{order:row.order_id,payer:customer.publicKey.toBase58()});

 // 0b. The driver reports a custody incident through the real mobile API; that retained incident is what lets dispatch open a return case.
 const driver=(await db.query('SELECT p.account_id::text account FROM food_assignments a JOIN driver_profiles p ON p.id=a.driver_id WHERE a.id=$1',[ASSIGNMENT])).rows[0];
 await db.query('UPDATE mobile_accounts SET disabled_at=NULL WHERE id=$1',[driver.account]);
 const access=randomBytes(32).toString('base64url');
 await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')",[randomUUID(),driver.account,randomUUID(),sha(access),sha(randomUUID())]);
 const report=await fetch((process.env.BITPOS_REFUND_API??'http://127.0.0.1:3046')+'/api/mobile/v1/driver/food/assignments/'+ASSIGNMENT+'/incidents',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+access},body:JSON.stringify({idempotencyKey:randomUUID(),generation:String(row.generation),leaseGeneration:String(row.lease_generation),kind:'CUSTODY',body:'Devnet refund rehearsal: customer unreachable, food kept in custody'}),signal:AbortSignal.timeout(20000)});
 const reportBody=await report.text(),open=(await db.query('SELECT count(*)::int n FROM food_assignment_incidents WHERE assignment_id=$1 AND blocks_duty AND resolved_at IS NULL',[ASSIGNMENT])).rows[0].n;
 assert.ok(report.status===200||open>0,'Incident report failed: '+reportBody.slice(0,300));assert.ok(open>0,'No retained blocking incident');step('driver reported custody incident',{status:report.status});
 row=(await db.query('SELECT a.*,s.merchant_id,s.order_id,s.version shipment_version FROM food_assignments a JOIN food_shipments s ON s.id=a.shipment_id WHERE a.id=$1',[ASSIGNMENT])).rows[0];

 // 1. Return case through the real adapters and SQL authorities (dispatcher requests, merchant receives, dispatcher resolves, administrator decides).
 const actor=randomUUID(),session=randomUUID(),grant=randomUUID(),user=randomUUID(),hash=sha('return108-session-'+randomUUID());
 await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');
 await db.query('INSERT INTO mobile_accounts(id,auth_subject)VALUES($1,$1)',[actor]);
 await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,actor,randomUUID(),sha(session),sha('refresh'+session)]);
 await db.query("INSERT INTO platform_staff_role_grants(id,account_id,role,granted_by,expires_at)VALUES($1,$2,'dispatcher','Devnet refund rehearsal; disposable database',clock_timestamp()+interval '1 hour')",[grant,actor]);await db.query('INSERT INTO platform_role_scopes VALUES($1,$2)',[grant,row.merchant_id]);
 const adminGrant=randomUUID();await db.query("INSERT INTO platform_staff_role_grants(id,account_id,role,granted_by,expires_at)VALUES($1,$2,'administrator','Devnet refund rehearsal; disposable database',clock_timestamp()+interval '1 hour')",[adminGrant,actor]);await db.query('INSERT INTO platform_role_scopes VALUES($1,$2)',[adminGrant,row.merchant_id]);
 await db.query("INSERT INTO members(user_id,merchant_id,role)VALUES($1,$2,'owner')",[user,row.merchant_id]);await db.query("INSERT INTO sessions VALUES($1,$2,$3,'owner',clock_timestamp()+interval '1 hour')",[hash,user,row.merchant_id]);
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true),set_config('bitpos.merchant',$4,true)",[actor,session,sha(session),row.merchant_id]);
 const version=async()=>String((await db.query('SELECT version::text FROM food_shipments WHERE id=$1',[row.shipment_id])).rows[0].version);
 const requested=await prepareFoodReturnCandidate(db,row.id,{idempotencyKey:randomUUID(),expectedVersion:String(row.shipment_version),generation:String(row.generation),leaseGeneration:String(row.lease_generation),reason:'Devnet refund rehearsal return request'});
 step('return requested',{caseId:requested.caseId});
 await recordFoodReturnCandidate(db,requested.caseId,hash,{idempotencyKey:randomUUID(),expectedVersion:await version(),condition:'DAMAGED',reason:'Devnet rehearsal merchant receipt'});
 const incidents=(await db.query('SELECT id,version::text FROM food_assignment_incidents WHERE assignment_id=$1 AND blocks_duty AND resolved_at IS NULL',[row.id])).rows;
 for(const incident of incidents)await db.query('SELECT dispatch_food_ack_incident($1,$2)',[incident.id,{idempotencyKey:randomUUID(),expectedVersion:incident.version,reason:'Devnet rehearsal incident review'}]);
 await resolveFoodReturnCandidate(db,requested.caseId,{idempotencyKey:randomUUID(),expectedVersion:await version(),reason:'Devnet rehearsal return custody resolved'});
 const decision=(await db.query('SELECT food_return109_decide($1,$2) value',[requested.caseId,{idempotencyKey:randomUUID(),expectedVersion:await version(),decision:'FULL_REFUND',reason:'Devnet rehearsal full refund approval; test tokens only'}])).rows[0].value;
 assert.equal(decision.fundsTransferred,false);
 await db.query('COMMIT');
 const allocation=(await db.query('SELECT a.*,pa.payer expected_beneficiary FROM food_return109_allocations a JOIN payments p ON p.id=a.payment_id JOIN payment_attempt_assets pa ON pa.attempt_id=p.attempt_id WHERE a.case_id=$1',[requested.caseId])).rows[0];
 assert.ok(allocation,'No allocation was created');assert.equal(allocation.beneficiary,customer.publicKey.toBase58());
 const amount=BigInt(allocation.amount_minor);step('refund approved',{caseId:requested.caseId,paymentId:allocation.payment_id,amountMinor:String(amount),beneficiary:allocation.beneficiary});

 // 2. Provider policy, restricted worker role and verified funding (real inbound transfers).
 const config=randomUUID(),policy=randomUUID();
 await db.query("INSERT INTO settlement088_provider_configs(id,merchant_id,provider,network,genesis_hash,mint_public_key,token_program_public_key,sender_public_key,fee_payer_public_key,currency,decimals,asset_descriptor,adapter_version,enabled)VALUES($1,$2,'solana-devnet','solana-devnet',$3,$4,$5,$6,$7,'USDG',6,$8,'devnet-live-v1',true)",[config,row.merchant_id,USDG_ASSET.genesisHash,USDG_ASSET.mint,USDG_ASSET.tokenProgram,sender.publicKey.toBase58(),sponsor.publicKey.toBase58(),allocation.asset_descriptor]);
 await db.query('INSERT INTO food_refund111_policies(id,config_id,config_version,enabled,max_fee_lamports,max_total_lamports)VALUES($1,$2,1,true,10000,3000000)',[policy,config]);
 await db.query(`DO $$BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}')THEN CREATE ROLE ${role} LOGIN;END IF;END$$`);await db.query(`GRANT bitpos_refund_worker TO ${role}`);
 await db.query(`GRANT EXECUTE ON FUNCTION food_refund110_snapshot(uuid),food_refund110_prepare(uuid,bigint,jsonb),food_refund110_unknown(uuid,bigint,text),food_refund111_record(uuid,jsonb,text),food_refund111_reserve(uuid,uuid,uuid),food_refund111_config(uuid),food_refund111_lookup(uuid,text),food_refund112_record(uuid,text,jsonb,text),food_refund112_snapshot(uuid),food_refund113_record(uuid,jsonb,text),food_refund113_reserve(uuid,uuid),food_refund113_config(uuid),food_refund113_lookup(uuid,text),food_refund114_snapshot(uuid),food_refund114_submit(uuid,bigint,text) TO ${role}`);
 const lane=process.env.BITPOS_REFUND_LANE==='1';
 if(lane){
  if(!(await db.query("SELECT to_regprocedure('bitpos.food_refund161_work(int)') p")).rows[0].p)await db.query(readFileSync('supabase/migrations/161_food_refund_work_queue.sql','utf8'));
  await db.query(`GRANT EXECUTE ON FUNCTION food_refund161_work(int) TO ${role}`);
 }
 pool=new pg.Pool({host:'127.0.0.1',port:55440,database:'bitpos_delivery_fixture',user:role,max:3,options:'-c search_path=bitpos,public'});
 const transaction=createRefundSqlTransaction(pool);

 const fundingTx=new Transaction().add(spl.createTransferCheckedWithFeeInstruction(ata(reserve.publicKey),mint,ata(sender.publicKey),reserve.publicKey,amount,6,0n,[],program));
 const fundingSignature=await finalize(fundingTx,reserve);step('inbound USDG funding finalized',{signature:fundingSignature,amountMinor:String(amount)});
 const feeTx=new Transaction().add(SystemProgram.transfer({fromPubkey:reserve.publicKey,toPubkey:sponsor.publicKey,lamports:3_000_000}));
 const feeSignature=await finalize(feeTx,reserve);step('inbound fee credit finalized',{signature:feeSignature,lamports:3_000_000});

 const funding=createFoodRefundFunding({transaction,connection:finalized});
 const credit=await funding.record({policyId:policy,expectedConfigVersion:'1',signature:fundingSignature});assert.equal(credit.status,'RECORDED',JSON.stringify(credit));if(credit.status!=='RECORDED')throw Error('unreachable');
 const held=await funding.reserve({creditId:credit.receipt.creditId,caseId:requested.caseId,paymentId:allocation.payment_id});assert.equal(held.status,'RESERVED',JSON.stringify(held));if(held.status!=='RESERVED')throw Error('unreachable');
 const attemptId=held.attemptId;step('funding recorded and reserved',{attemptId});
 const feeFunding=createRefundFeeFunding({transaction,connection:finalized});
 const feeCredit=await feeFunding.record({policyId:policy,expectedConfigVersion:'1',signature:feeSignature});assert.equal(feeCredit.status,'RECORDED',JSON.stringify(feeCredit));if(feeCredit.status!=='RECORDED')throw Error('unreachable');
 const feeHeld=await feeFunding.reserve({creditId:feeCredit.receipt.creditId,attemptId});assert.equal(feeHeld.status,'RESERVED',JSON.stringify(feeHeld));step('fee credit reserved',feeHeld);

 // 3. The coordinator signs, authorizes, broadcasts and reconciles the exact prepared bytes.
 const store=createFoodRefundSqlStore(transaction,{receipts:'112',submission:'114'});
 const provider=createPayoutProvider({kind:'solana-devnet',sourceOwner:sender.publicKey.toBase58(),feePayerOwner:sponsor.publicKey.toBase58(),allowedAssetIds:[USDG_ASSET.assetId],maxAmountMinor:String(amount),maxFeeLamports:10000,maxTotalLamports:3000000},{
  connection,resolveAsset:async id=>id===USDG_ASSET.assetId?USDG_ASSET:null,loadSigningKeys:async()=>({source:sender,feePayer:sponsor}),
 });
 assert.equal(provider.kind,'ready');
 const laneWorker=lane?createFoodRefundWorker({sourceOwner:sender.publicKey.toBase58(),feePayerOwner:sponsor.publicKey.toBase58(),allowedAssetIds:[USDG_ASSET.assetId],maxAmountMinor:String(amount),maxFeeLamports:10000,maxTotalLamports:3000000,maxAttemptsPerTick:3},{transaction,provider}):null;
 let state='';
 for(let n=0;n<60;n++){
  const outcome=lane?JSON.stringify(await laneWorker!.tick()):await executeFoodRefundAttempt(store,provider,attemptId);
  state=(await store.snapshot(attemptId)).state;step('tick '+n,{outcome,state});
  if(state==='FINALIZED'||state==='FAILED')break;
  await sleep(4000);
 }
 const after={customer:await usdg(customer.publicKey),treasury:await usdg(sender.publicKey)};step('balances after',after);
 const evidence=(await db.query('SELECT count(*)::int receipts,max(evidence->>\'signature\') signature,bool_or(posting_id IS NOT NULL) posted FROM food_refund112_receipts WHERE attempt_id=$1 AND outcome=\'FINALIZED\'',[attemptId])).rows[0];
 step('ledger',evidence);
 await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');
 await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true),set_config('bitpos.merchant',$4,true)",[actor,session,sha(session),row.merchant_id]);
 const projection=(await db.query('SELECT food_refund116_execution($1) value',[requested.caseId])).rows[0].value;await db.query('COMMIT');
 const onChain=await connection.getTransaction(evidence.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});assert.ok(onChain&&onChain.meta?.err===null,'Refund transaction is not successful on chain');step('on-chain check',{slot:onChain.slot,err:onChain.meta.err});step('execution projection',{state:projection.state,allPaymentsRefunded:projection.allPaymentsRefunded});
 Object.assign(result,{before,after,fundingSignature,feeSignature,refundSignature:evidence.signature,projection:projection.state});
 assert.equal(state,'FINALIZED');
 assert.equal(Math.round((after.customer-before.customer)*1e6),Number(amount),'Customer balance did not increase by the refund amount');
 console.log('PASS_REAL_DEVNET_FOOD_REFUND',JSON.stringify(result));
}catch(error){console.error('FAIL',error instanceof Error?error.message:error);process.exitCode=1;}
finally{await pool?.end();await db.end();}
