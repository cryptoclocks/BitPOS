// Real Solana-devnet rider payout through the product's own settlement path.
// Disposable local DB/API only. Keys are read from the private directory in this process and never printed.
// Flow: finance releases an ACCRUED earning -> rider-1 proves wallet ownership -> finance prepares and reserves
// a batch -> a real inbound USDG transfer funds the sender -> the settlement worker signs, broadcasts and verifies.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {Connection,Keypair,PublicKey,Transaction} from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import {beneficiaryOwnershipChallengeMessage,type BeneficiaryOwnershipChallenge} from '../../apps/worker/src/payout-provider';
import {createDriverSettlementWorker,createDriverSettlementTransaction} from '../../apps/worker/src/driver-settlement';
import {createSettlementFundingRuntime} from '../../apps/worker/src/settlement-funding-runtime';
import {USDG_ASSET} from '../../packages/domain/src/payment-assets';

const API=process.env.BITPOS_PAYOUT_API??'http://127.0.0.1:3046',RPC='https://api.devnet.solana.com',DEVNET_GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const keyDir=process.env.BITPOS_DEVNET_KEY_DIR??join(homedir(),'Desktop','BitPOS-Devnet-Private','keys');
const key=(role:string)=>Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(join(keyDir,role+'.json'),'utf8'))));
const rider=key('rider-1'),sender=key('merchant-a-treasury'),sponsor=key('fee-sponsor'),reserve=key('reserve');
const connection=new Connection(RPC,'confirmed'),mint=new PublicKey(USDG_ASSET.mint),program=new PublicKey(USDG_ASSET.tokenProgram);
const ata=(owner:PublicKey)=>spl.getAssociatedTokenAddressSync(mint,owner,false,program);
const usdg=async(owner:PublicKey)=>Number((await connection.getTokenAccountBalance(ata(owner))).value.amount)/1e6;
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55440/bitpos_delivery_fixture'});
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const step=(name:string,detail:unknown='')=>console.log('STEP',name,typeof detail==='string'?detail:JSON.stringify(detail));
async function call(path:string,method='GET',body?:unknown,token?:string,expect=200){
 const response=await fetch(API+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const text=await response.text();let json:any=null;try{json=JSON.parse(text);}catch{}
 if(response.status!==expect)throw Error(`${method} ${path} -> ${response.status} ${text.slice(0,300)}`);
 return json;
}
async function session(account:string){
 const access=randomBytes(32).toString('base64url'),device=randomUUID();
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours')",[randomUUID(),account,device,sha(access),sha(randomBytes(32).toString('base64url'))]);
 return access;
}
await db.connect();
const finalState={} as Record<string,unknown>;
try{
 const genesis=await connection.getGenesisHash();assert.equal(genesis,DEVNET_GENESIS,'Unexpected cluster');
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const before={rider:await usdg(rider.publicKey),sender:await usdg(sender.publicKey)};step('balances before',before);

 // 1. Pick an ACCRUED earning and act as its driver and as a scoped finance operator.
 const accrual=(await db.query("SELECT e.id::text,p.account_id::text account FROM bitpos.earning_accruals e JOIN bitpos.driver_profiles p ON p.id=e.driver_id WHERE e.state='ACCRUED' ORDER BY e.created_at DESC LIMIT 1")).rows[0];assert.ok(accrual,'No ACCRUED earning in the disposable database');
 await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=NULL WHERE id=$1',[accrual.account]); // earlier smokes retire their synthetic accounts
 const driverToken=await session(accrual.account);
 const items=await call('/api/mobile/v1/driver/earnings','GET',undefined,driverToken),item=items.items.find((i:any)=>i.accrualId===accrual.id);assert.ok(item,'Earning not visible to its driver');
 assert.equal(item.state,'ACCRUED');const payout=BigInt(item.payout.payoutMoney.amountMinor);step('earning',{accrualId:item.accrualId,state:item.state,payoutMinor:String(payout),merchantId:item.merchantId??item.merchant?.id??null});
 const merchant=item.merchantId as string;
 assert.ok(merchant,'Cannot resolve the earning merchant');
 const financeAccount=randomUUID();await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[financeAccount,randomUUID()]);
 const grant=randomUUID();await db.query("INSERT INTO bitpos.platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,'finance','Local devnet payout rehearsal; disposable database',clock_timestamp()+interval '2 hours')",[grant,financeAccount]);await db.query('INSERT INTO bitpos.platform_role_scopes VALUES($1,$2)',[grant,merchant]);
 const financeToken=await session(financeAccount);

 // 2. Finance releases the earning; rider-1 proves ownership of the payout wallet.
 const release=await call('/api/mobile/v1/platform/earnings/'+item.accrualId+'/eligibility','POST',{idempotencyKey:randomUUID(),expectedVersion:item.version,decision:'RELEASE',reason:'Devnet rehearsal release; test tokens only'},financeToken);assert.equal(release.fundsTransferred,false);step('released',{version:release.version});
 const enroll='/api/mobile/v1/driver/payout-beneficiaries';
 const pending=await call(enroll,'POST',{idempotencyKey:randomUUID(),expectedVersion:'0',merchantId:merchant,provider:'solana-devnet',publicKey:rider.publicKey.toBase58()},driverToken);
 const challenge=pending.challenge as BeneficiaryOwnershipChallenge;
 const signature=bs58.encode(nacl.sign.detached(Buffer.from(beneficiaryOwnershipChallengeMessage(challenge)),rider.secretKey));
 const verified=await call(enroll+'/'+pending.beneficiaryId+'/verify','POST',{idempotencyKey:randomUUID(),expectedVersion:'1',signature},driverToken);assert.equal(verified.state,'VERIFIED');step('beneficiary verified',{beneficiaryId:pending.beneficiaryId,wallet:rider.publicKey.toBase58()});

 // 3. Provider configuration, batch preparation and reservation (ledger-backed, no money moved yet).
 const configId=randomUUID();
 await db.query("INSERT INTO bitpos.settlement088_provider_configs(id,merchant_id,provider,network,genesis_hash,mint_public_key,token_program_public_key,sender_public_key,fee_payer_public_key,currency,decimals,asset_descriptor,adapter_version,enabled) VALUES($1,$2,'solana-devnet','solana-devnet',$3,$4,$5,$6,$7,'USDG',6,$8,'devnet-live-v1',true)",[configId,merchant,USDG_ASSET.genesisHash,USDG_ASSET.mint,USDG_ASSET.tokenProgram,sender.publicKey.toBase58(),sponsor.publicKey.toBase58(),USDG_ASSET]);
 const batches='/api/mobile/v1/platform/settlement-batches';
 const prepare={idempotencyKey:randomUUID(),expectedVersion:'0',merchantId:merchant,driverId:item.driverId??(await db.query('SELECT driver_id::text d FROM bitpos.earning_accruals WHERE id=$1',[accrual.id])).rows[0].d,beneficiaryId:pending.beneficiaryId,beneficiaryVersion:verified.version,sourceIds:[item.accrualId],sourceVersions:[release.version]};
 const draft=await call(batches,'POST',prepare,financeToken);assert.equal(draft.fundsTransferred,false);
 const reserved=await call(batches+'/'+draft.batchId+'/commands','POST',{kind:'APPROVE_RESERVE',idempotencyKey:randomUUID(),expectedVersion:draft.version,beneficiaryId:pending.beneficiaryId,beneficiaryVersion:verified.version,sourceIds:prepare.sourceIds,sourceVersions:prepare.sourceVersions,reason:'Devnet rehearsal reserve; test tokens only'},financeToken);step('reserved',{batchId:draft.batchId,state:reserved.state});

 // 4. Fund the sender with a real inbound USDG transfer, then record it through the verifying funding runtime.
 const fundingTx=new Transaction().add(spl.createTransferCheckedWithFeeInstruction(ata(reserve.publicKey),mint,ata(sender.publicKey),reserve.publicKey,payout,6,0n,[],program));
 fundingTx.feePayer=reserve.publicKey;const latest=await connection.getLatestBlockhash('finalized');fundingTx.recentBlockhash=latest.blockhash;fundingTx.sign(reserve);
 const fundingSignature=await connection.sendRawTransaction(fundingTx.serialize(),{skipPreflight:false});await connection.confirmTransaction({signature:fundingSignature,...latest},'finalized');step('inbound funding finalized',{signature:fundingSignature,amountMinor:String(payout)});
 const env={BITPOS_SETTLEMENT_FUNDING_ENABLED:'1',BITPOS_SETTLEMENT_FUNDING_DATABASE_URL:'postgresql://bitpos_settlement088_fixture@127.0.0.1:55440/bitpos_delivery_fixture',BITPOS_SETTLEMENT_RPC_URL:RPC};
 const funding=createSettlementFundingRuntime(env,new Connection(RPC,'finalized'));
 try{const recorded=await funding.recorder.record({configId,expectedConfigVersion:'1',signature:fundingSignature});assert.equal(recorded.status,'RECORDED',JSON.stringify(recorded));step('funding recorded',recorded.status);}finally{await funding.close();}

 // 5. The settlement worker prepares, signs, broadcasts and reconciles on devnet.
 const pool=new pg.Pool({connectionString:'postgresql://bitpos_settlement088_fixture@127.0.0.1:55440/bitpos_delivery_fixture',max:3}),transaction=createDriverSettlementTransaction(pool);
 const config={kind:'enabled' as const,adapterVersion:'devnet-live-v1',provider:{kind:'solana-devnet' as const,sourceOwner:sender.publicKey.toBase58(),feePayerOwner:sponsor.publicKey.toBase58(),allowedAssetIds:[USDG_ASSET.assetId],maxAmountMinor:String(payout),maxFeeLamports:20000,maxTotalLamports:3000000},maxBatchesPerTick:5,maxTerminalAttemptsPerTick:5};
 const worker=createDriverSettlementWorker(config,{transaction,providerDeps:{connection,loadSigningKeys:async()=>({source:sender,feePayer:sponsor})}});
 let attempt:any;
 try{
  for(let n=0;n<40;n++){
   const report=await worker.tick();attempt=(await db.query('SELECT id::text,state FROM bitpos.settlement088_attempts WHERE batch_id=$1',[draft.batchId])).rows[0];
   step('tick '+n,{report:JSON.stringify(report).slice(0,200),attempt:attempt?.state??null});
   if(attempt&&['CONFIRMED','FAILED'].includes(attempt.state))break;
   if(attempt)await worker.reconcileAttempts([attempt.id]);
   await new Promise(r=>setTimeout(r,4000));
  }
 }finally{await pool.end();}
 const outcome=(await db.query("SELECT e.state earning,b.state batch,a.state attempt,(SELECT r.provider_evidence->>'signature' FROM bitpos.settlement088_verified_receipts r WHERE r.attempt_id=a.id LIMIT 1) signature FROM bitpos.settlement088_attempts a JOIN bitpos.settlement088_batches b ON b.id=a.batch_id JOIN bitpos.settlement088_items i ON i.batch_id=b.id JOIN bitpos.earning_accruals e ON e.id=i.accrual_id WHERE a.batch_id=$1",[draft.batchId])).rows[0];
 step('outcome',outcome);
 const after={rider:await usdg(rider.publicKey),sender:await usdg(sender.publicKey)};step('balances after',after);
 Object.assign(finalState,{before,after,outcome,fundingSignature});
 assert.equal(outcome.attempt,'CONFIRMED');assert.equal(outcome.earning,'SETTLED');
 assert.equal(Math.round((after.rider-before.rider)*1e6),Number(payout),'Rider balance did not increase by the payout');
 console.log('PASS_REAL_DEVNET_RIDER_PAYOUT',JSON.stringify(finalState));
}catch(error){console.error('FAIL',error instanceof Error?error.message:error);process.exitCode=1;}
finally{await db.end();}
