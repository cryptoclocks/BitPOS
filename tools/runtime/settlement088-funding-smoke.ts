import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {writeFile} from 'node:fs/promises';import pg from 'pg';import {PublicKey} from '@solana/web3.js';
import {createSettlementFundingRuntime} from '../../apps/worker/src/settlement-funding-runtime';import {createSettlementFundingRecorder} from '../../apps/worker/src/settlement-funding';import {createDriverSettlementTransaction} from '../../apps/worker/src/driver-settlement';
import {fundingFixture,recipient,fixture,chainReceipt} from '../../tests/payout-provider.fixture';import {USDG_ASSET} from '../../packages/domain/src/payment-assets';
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'}),pool=new pg.Pool({connectionString:'postgresql://bitpos_settlement088_fixture@127.0.0.1:55436/bitpos_delivery_fixture',max:2});
const merchant=randomUUID(),config=randomUUID(),env={BITPOS_SETTLEMENT_FUNDING_ENABLED:'1',BITPOS_SETTLEMENT_FUNDING_DATABASE_URL:'postgresql://bitpos_settlement088_fixture@127.0.0.1:55436/bitpos_delivery_fixture',BITPOS_SETTLEMENT_RPC_URL:'http://127.0.0.1:1'},passed:string[]=[];
const runtimes:ReturnType<typeof createSettlementFundingRuntime>[]=[];await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 await db.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'SETTLEMENT088 COMMITTED FUNDING FIXTURE','11111111111111111111111111111111')",[merchant]);
 await db.query("INSERT INTO bitpos.settlement088_provider_configs(id,merchant_id,provider,network,genesis_hash,mint_public_key,token_program_public_key,sender_public_key,fee_payer_public_key,currency,decimals,asset_descriptor,adapter_version,enabled) VALUES($1,$2,'solana-devnet','solana-devnet',$3,$4,$5,$6,$6,'USDG',6,$7,'synthetic-v1',true)",[config,merchant,USDG_ASSET.genesisHash,USDG_ASSET.mint,USDG_ASSET.tokenProgram,recipient.publicKey.toBase58(),USDG_ASSET]);
 const fresh=async(label:string)=>fundingFixture(USDG_ASSET,new PublicKey(createHash('sha256').update(config+label).digest()).toBase58());
 const f=await fresh('runtime'),signs=f.state.signs,runtime=createSettlementFundingRuntime(env,f.connection);runtimes.push(runtime);
 const request={configId:config,expectedConfigVersion:'1',signature:f.input.signature},recorded=await runtime.recorder.record(request);assert.equal(recorded.status,'RECORDED');
 assert.deepEqual(await runtime.recorder.record(request),recorded);assert.equal(f.state.signs,signs);assert.equal(f.state.sends.length,0);passed.push('Actual private configured runtime verifies finalized Token2022 transfer and commits immutable1000 atoms; replay preserves identity with no signing/send');
 const a=await fresh('lost-commit'),transaction=createDriverSettlementTransaction(pool);let lose=true,committed=false;
 const recorder=createSettlementFundingRecorder({connection:a.connection,transaction:async run=>{
  let record=false;const result=await transaction(db=>run({query:async(sql,args)=>{if(sql.includes('settlement088_worker_funding_record'))record=true;return db.query(sql,args);}}));
  if(record&&lose){lose=false;committed=true;throw Error('SYNTHETIC_POST_COMMIT_RESPONSE_LOSS');}return result;
 }});
 const recovered=await recorder.record({...request,signature:a.input.signature});assert.equal(recovered.status,'RECORDED');assert.equal(committed,true);assert.deepEqual(await recorder.record({...request,signature:a.input.signature}),recovered);passed.push('Real SQL COMMIT followed by injected lost acknowledgement recovers original network/signature evidence and retries without a second effect');
 assert.equal((await runtime.recorder.record({...request,expectedConfigVersion:'2'})).status,'UNAVAILABLE');
 await assert.rejects(runtime.recorder.record({...request,configId:randomUUID()}));
 for(const kind of ['chain','recipient','CPI','ATA'] as const){
  const negative=await fresh(kind);
  if(kind==='chain')negative.state.genesis='wrong-genesis';
  if(kind==='recipient')negative.state.chain!.meta.postTokenBalances[1].owner=PublicKey.default.toBase58();
  if(kind==='CPI')negative.state.chain!.meta.innerInstructions=[{index:0,instructions:[{}]}];
  let signature=negative.input.signature;
  if(kind==='ATA'){const original=fixture(USDG_ASSET);original.state.recipientExists=false;const p=await original.prepare();negative.state.chain=chainReceipt(p);signature=p.signature;}
  const entry=createSettlementFundingRuntime(env,negative.connection);runtimes.push(entry);const result=await entry.recorder.record({...request,signature});assert.equal(result.status,'UNAVAILABLE',kind);assert.equal(negative.state.sends.length,0);
 }
 passed.push('Wrong config/version/recipient/genesis, opaque CPI and valid signed ATA-creation transaction cannot record funding');
 const rows=(await db.query('SELECT id::text,config_id::text,config_version::text,external_reference,amount_minor::text,currency,decimals,provider_evidence FROM bitpos.settlement088_funding_evidence WHERE config_id=$1 ORDER BY id',[config])).rows;
 assert.equal(rows.length,2);for(const row of rows){assert.equal(row.config_id,config);assert.equal(row.config_version,'1');assert.equal(row.amount_minor,'1000');assert.equal(row.currency,'USDG');assert.equal(row.decimals,6);assert.equal(row.provider_evidence.recipientOwner,recipient.publicKey.toBase58());assert.equal(row.provider_evidence.signature,row.external_reference);assert.deepEqual(row.provider_evidence.asset,USDG_ASSET);}
 const receipt={status:'PASS_PRIVATE_RUNTIME_COMMITTED_FUNDING_AND_LOST_ACK_RECOVERY',configId:config,merchantId:merchant,evidenceIds:rows.map(row=>row.id),passed,fixture:'Disposable55436 persisted SQL with actual private runtime and deterministic signed Token2022 provider transport; post-COMMIT acknowledgement loss is injected at transaction adapter. No RPC network, real funding, key files or transfers.',limits:['CLI transport arguments share configured runtime but success exercised via imported private runtime; CLI disabled state separately checked','No outgoing-worker/AVD/finance acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/settlement088-funding-committed-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{
 for(const runtime of runtimes)await runtime.close();await pool.end();await db.query('UPDATE bitpos.settlement088_provider_configs SET enabled=false,version=version+1 WHERE id=$1 AND enabled',[config]);await db.end();
}
