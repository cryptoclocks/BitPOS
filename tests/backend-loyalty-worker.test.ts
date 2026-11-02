import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import bs58 from 'bs58';
import type {LoyaltyChainPort} from '../apps/worker/src/loyalty';
// "Regulars" badge worker (migration 180, step 2) against a database with every migration applied and a FAKE chain.
// Real-chain behaviour is covered separately by tools/devnet/loyalty-smoke.ts. Skipped without BITPOS_BACKEND_INTEGRATION=1.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'||!process.env.ADMIN_DATABASE_URL};
const worker=integration.skip?(undefined as never):await import('../apps/worker/src/loyalty') as typeof import('../apps/worker/src/loyalty');
const dbm=integration.skip?(undefined as never):await import('../apps/api/src/db') as typeof import('../apps/api/src/db');
const loyalty=integration.skip?(undefined as never):await import('../apps/api/src/loyalty') as typeof import('../apps/api/src/loyalty');
const addr=()=>bs58.encode(randomBytes(32)),sig=()=>bs58.encode(randomBytes(64));

class FakeChain implements LoyaltyChainPort{
 held=new Map<string,bigint>();issues=0;revokes=0;failIssue=0;landThenThrow=false;failRevoke=0;
 key=(m:string,w:string)=>m+'|'+w;
 async balance(m:string,w:string){return this.held.get(this.key(m,w))??0n;}
 async issue(m:string,w:string){
  if(this.failIssue>0){this.failIssue--;throw new Error('LOYALTY_CHAIN_DOWN');}
  if((await this.balance(m,w))>=1n)return null;
  this.issues++;this.held.set(this.key(m,w),1n);
  if(this.landThenThrow){this.landThenThrow=false;throw new Error('timeout after send');}
  return sig();
 }
 async revoke(m:string,w:string){if(this.failRevoke>0){this.failRevoke--;throw new Error('LOYALTY_CHAIN_DOWN');}if((await this.balance(m,w))<1n)return null;this.revokes++;this.held.set(this.key(m,w),0n);return sig();}
}
async function world(){
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 await admin.query('SET search_path=bitpos,public');
 const merchant=randomUUID(),price=randomUUID(),branch=randomUUID();
 await admin.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Loyalty worker test',$2)",[merchant,'1'.repeat(32)]);
 await admin.query("SET session_replication_role='replica'");
 await admin.query("INSERT INTO catalog_price_versions(id,merchant_id,currency,decimals,provenance,demo_label,quote_policy) VALUES($1,$2,'USD',2,'demo_configured','LOYALTY TEST','USD_CENTS_TO_USDG_1_TO_1')",[price,merchant]);
 await admin.query('INSERT INTO merchant_pricing(merchant_id,active_price_version_id,revision) VALUES($1,$2,1)',[merchant,price]);
 await admin.query("SET session_replication_role='origin'");
 const tier=async(slot:number,minPoints:number,mint:string|null=addr())=>{
  await dbm.tenant(merchant,async db=>{await loyalty.loyaltySettings(db,merchant,randomUUID(),'owner','PUT',{slot,nameTh:'ระดับ'+slot,nameEn:'Tier '+slot,minPoints,enabled:true});
   if(mint)await db.query('SELECT bitpos.loyalty180_set_mint($1,$2,$3)',[slot,mint,sig()]);});
 };
 const member=async(o:{consent?:boolean;wallet?:boolean;points?:number}={})=>{
  const account=randomUUID(),wallet=addr();
  await admin.query("SET session_replication_role='replica'");
  await admin.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
  await admin.query("SET session_replication_role='origin'");
  if(o.consent!==false)await admin.query("INSERT INTO loyalty180_consents(account_id,merchant_id,version) VALUES($1,$2,'t')",[account,merchant]);
  if(o.wallet!==false)await admin.query("INSERT INTO loyalty180_wallet_bindings(account_id,wallet_address,challenge_hash) VALUES($1,$2,$3)",[account,wallet,'a'.repeat(64)]);
  const orders:string[]=[];
  const pay=async(units:number)=>{
   const id=randomUUID();await admin.query("SET session_replication_role='replica'");
   await admin.query("INSERT INTO orders(id,merchant_id,customer_id,access_token,idempotency_key,request_hash,status,authority_version,thb_minor,terminal_id,usdg_minor,treasury,quote_expires_at) VALUES($1,$2,$3,$4,$5,'h','PAID',2,NULL,NULL,1,$6,now()+interval '1 day')",[id,merchant,randomUUID(),randomUUID()+randomUUID(),randomUUID(),'1'.repeat(32)]);
   await admin.query("INSERT INTO order_authority(merchant_id,order_id,source_kind,source_account_id,source_branch_id,source_label_snapshot,serving_kind,serving_label_snapshot,quote_id,price_version_id,catalog_currency,catalog_decimals,total_minor,settlement) VALUES($1,$2,'online',$6,$7,'t','pickup','t',$3,$4,'USD',2,$5,'{}')",[merchant,id,randomUUID(),price,units*100,account,branch]);
   await admin.query("INSERT INTO online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_deadline) VALUES($1,$2,$3,$4,now()+interval '1 day')",[merchant,id,account,branch]);
   await admin.query("SET session_replication_role='origin'");orders.push(id);return id;
  };
  if(o.points)await pay(o.points);
  return {account,wallet,pay};
 };
 const refund=async(orderId:string)=>{await admin.query("SET session_replication_role='replica'");await admin.query("INSERT INTO refunds(merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary,cause) VALUES($1,$2,$3,100,'{}','{}','b','ONLINE_ACCEPTANCE_REJECTED')",[merchant,orderId,randomUUID()]);await admin.query("SET session_replication_role='origin'");};
 const rows=async()=>(await admin.query("SELECT m.account_id,m.tier_slot,m.status,m.attempts,m.signature,m.wallet_address,m.last_error FROM loyalty180_mints m WHERE m.merchant_id=$1 ORDER BY m.created_at",[merchant])).rows;
 return {admin,merchant,tier,member,refund,rows,close:()=>admin.end()};
}

test('only consenting members with a proven wallet and a reached tier are queued, once, at their highest tier',integration,async()=>{
 const w=await world();try{
  await w.tier(1,5);await w.tier(2,20);
  const gold=await w.member({points:25}),silver=await w.member({points:7}),none=await w.member({points:2}),noConsent=await w.member({points:30,consent:false}),noWallet=await w.member({points:30,wallet:false});
  const chain=new FakeChain();
  await worker.tickLoyaltyMerchant(w.merchant,chain);
  const rows=await w.rows();
  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(r=>[r.account_id,r.tier_slot,r.status]).sort(),[[gold.account,2,'CONFIRMED'],[silver.account,1,'CONFIRMED']].sort());
  assert.ok(![none.account,noConsent.account,noWallet.account].some(a=>rows.some(r=>r.account_id===a)));
  assert.equal(chain.issues,2);
  await worker.tickLoyaltyMerchant(w.merchant,chain);await worker.tickLoyaltyMerchant(w.merchant,chain);
  assert.equal((await w.rows()).length,2);assert.equal(chain.issues,2,'repeated ticks send nothing more');
 }finally{await w.close();}
});

test('a send that landed but reported an error is settled by reading the chain, never by sending again',integration,async()=>{
 const w=await world();try{
  await w.tier(1,5);const m=await w.member({points:9});const chain=new FakeChain();chain.landThenThrow=true;
  await worker.tickLoyaltyMerchant(w.merchant,chain);
  const [row]=await w.rows();assert.equal(row.status,'CONFIRMED');assert.equal(chain.issues,1);
  await worker.tickLoyaltyMerchant(w.merchant,chain);assert.equal(chain.issues,1);void m;
 }finally{await w.close();}
});

test('transient chain failures retry and finally park as FAILED after 5 attempts; success in between confirms',integration,async()=>{
 const w=await world();try{
  await w.tier(1,5);await w.member({points:9});const chain=new FakeChain();chain.failIssue=2;
  await worker.tickLoyaltyMerchant(w.merchant,chain);let [r]=await w.rows();assert.deepEqual([r.status,r.attempts,r.last_error],['PENDING',1,'LOYALTY_CHAIN_DOWN']);
  await worker.tickLoyaltyMerchant(w.merchant,chain);[r]=await w.rows();assert.equal(r.status,'PENDING');
  await worker.tickLoyaltyMerchant(w.merchant,chain);[r]=await w.rows();assert.deepEqual([r.status,r.attempts,r.last_error],['CONFIRMED',3,'']);
 }finally{await w.close();}
 const v=await world();try{
  await v.tier(1,5);await v.member({points:9});const chain=new FakeChain();chain.failIssue=99;
  for(let i=0;i<6;i++)await worker.tickLoyaltyMerchant(v.merchant,chain);
  const [r]=await v.rows();assert.deepEqual([r.status,r.attempts],['FAILED',5]);assert.equal(chain.issues,0);
 }finally{await v.close();}
});

test('a worker that died mid-send is recovered by reading the chain: held → CONFIRMED, not held → sent exactly once',integration,async()=>{
 const w=await world();try{
  await w.tier(1,5);const a=await w.member({points:9}),b=await w.member({points:9});const chain=new FakeChain();
  await dbm.tenant(w.merchant,db=>db.query('SELECT bitpos.loyalty180_enqueue()'));
  await dbm.tenant(w.merchant,db=>db.query('SELECT * FROM bitpos.loyalty180_claim(10)'));            // both now SENT, then the worker "dies"
  const mint=(await w.admin.query('SELECT mint_address FROM loyalty180_tiers WHERE merchant_id=$1 AND slot=1',[w.merchant])).rows[0].mint_address;
  chain.held.set(chain.key(mint,a.wallet),1n);                                                      // a's send had landed
  await worker.tickLoyaltyMerchant(w.merchant,chain);
  assert.ok((await w.rows()).every(r=>r.status==='SENT'),'a fresh SENT row is not reclaimed before the lease expires');
  await w.admin.query("UPDATE loyalty180_mints SET updated_at=clock_timestamp()-interval '3 minutes' WHERE merchant_id=$1",[w.merchant]);
  await worker.tickLoyaltyMerchant(w.merchant,chain);
  const rows=await w.rows();assert.ok(rows.every(r=>r.status==='CONFIRMED'));assert.equal(chain.issues,1,'only b needed a send');void b;
 }finally{await w.close();}
});

test('a refund that drops the tier, or withdrawn consent, takes the badge back through the delegate; failures retry',integration,async()=>{
 const w=await world();try{
  await w.tier(1,5);const keep=await w.member({points:9}),refunded=await w.member({}),leaver=await w.member({points:9});
  const big=await refunded.pay(9);const chain=new FakeChain();
  await worker.tickLoyaltyMerchant(w.merchant,chain);assert.equal((await w.rows()).filter(r=>r.status==='CONFIRMED').length,3);
  await worker.tickLoyaltyMerchant(w.merchant,chain);assert.equal(chain.revokes,0,'nothing is taken back while everyone still qualifies');
  await w.refund(big);
  await w.admin.query("UPDATE loyalty180_consents SET withdrawn_at=clock_timestamp() WHERE account_id=$1",[leaver.account]);
  chain.failRevoke=1;await worker.tickLoyaltyMerchant(w.merchant,chain);
  let byAccount=Object.fromEntries((await w.rows()).map(r=>[r.account_id,r.status]));
  assert.equal(byAccount[keep.account],'CONFIRMED');assert.equal(chain.revokes,1);
  assert.deepEqual([byAccount[refunded.account],byAccount[leaver.account]].sort(),['CONFIRMED','REVOKED'],'one failed and returns to CONFIRMED to retry, one revoked');
  await worker.tickLoyaltyMerchant(w.merchant,chain);byAccount=Object.fromEntries((await w.rows()).map(r=>[r.account_id,r.status]));
  assert.equal(byAccount[refunded.account],'REVOKED');assert.equal(byAccount[leaver.account],'REVOKED');assert.equal(chain.revokes,2);assert.equal(byAccount[keep.account],'CONFIRMED');
  // re-consent later does not resurrect the revoked row; a fresh issue would need a new tier crossing (unique per member/tier)
  await worker.tickLoyaltyMerchant(w.merchant,chain);assert.equal(chain.issues,3);
 }finally{await w.close();}
});

test('tiers without a mint are never queued, and a tier that issued a badge keeps its threshold',integration,async()=>{
 const w=await world();try{
  await w.tier(1,5,null);await w.member({points:9});const chain=new FakeChain();
  await worker.tickLoyaltyMerchant(w.merchant,chain);assert.equal((await w.rows()).length,0);
  await dbm.tenant(w.merchant,db=>db.query('SELECT bitpos.loyalty180_set_mint($1,$2,$3)',[1,addr(),sig()]));
  await worker.tickLoyaltyMerchant(w.merchant,chain);assert.equal((await w.rows()).length,1);
  await assert.rejects(dbm.tenant(w.merchant,db=>loyalty.loyaltySettings(db,w.merchant,randomUUID(),'owner','PUT',{slot:1,nameTh:'x',nameEn:'x',minPoints:3,enabled:true})),(e:any)=>e.status===409&&e.details?.loyaltyCode==='LOYALTY_TIER_LOCKED');
  await assert.rejects(dbm.tenant(w.merchant,db=>db.query('SELECT bitpos.loyalty180_set_mint($1,$2,$3)',[1,addr(),sig()])),/LOYALTY_TIER_LOCKED/);
 }finally{await w.close();}
});

// REAL Solana devnet: needs BITPOS_LOYALTY_DEVNET=1 and the private key directory. Spends a few thousandths of a test SOL.
test('devnet end to end: real mint, real issue to a test wallet through the worker, real revoke after a refund',{skip:integration.skip||process.env.BITPOS_LOYALTY_DEVNET!=='1'},async()=>{
 const os=await import('node:os'),path=await import('node:path'),{Connection}=await import('@solana/web3.js');
 const chainLib=await import('../apps/api/src/loyalty-chain');
 const dir=process.env.BITPOS_DEVNET_KEY_DIR??path.join(os.homedir(),'Desktop','BitPOS-Devnet-Private');
 const connection=new Connection('https://api.devnet.solana.com','confirmed');
 const signers={connection,payer:chainLib.loadRoleKeypair(dir,'fee-sponsor'),issuer:chainLib.loadRoleKeypair(dir,'reward-issuer')};
 const holder=chainLib.loadRoleKeypair(dir,'customer-alice').publicKey.toBase58();
 const w=await world();try{
  await w.tier(1,5,null);
  const {mint,signature}=await chainLib.createTierMint(signers,{name:'Regulars Tier 1',symbol:'REG1',uri:'https://pay.cashlessthailand.com/loyalty/badge-1.json'});
  await dbm.tenant(w.merchant,db=>db.query('SELECT bitpos.loyalty180_set_mint($1,$2,$3)',[1,mint,signature]));
  const account=randomUUID();await w.admin.query("SET session_replication_role='replica'");await w.admin.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);await w.admin.query("SET session_replication_role='origin'");
  await w.admin.query("INSERT INTO loyalty180_consents(account_id,merchant_id,version) VALUES($1,$2,'t')",[account,w.merchant]);
  await w.admin.query("INSERT INTO loyalty180_wallet_bindings(account_id,wallet_address,challenge_hash) VALUES($1,$2,$3)",[account,holder,'b'.repeat(64)]);
  // paid order worth 9 points for this account
  const price=(await w.admin.query('SELECT active_price_version_id p FROM merchant_pricing WHERE merchant_id=$1',[w.merchant])).rows[0].p,order=randomUUID(),branch=randomUUID();
  await w.admin.query("SET session_replication_role='replica'");
  await w.admin.query("INSERT INTO orders(id,merchant_id,customer_id,access_token,idempotency_key,request_hash,status,authority_version,thb_minor,terminal_id,usdg_minor,treasury,quote_expires_at) VALUES($1,$2,$3,$4,$5,'h','PAID',2,NULL,NULL,1,$6,now()+interval '1 day')",[order,w.merchant,randomUUID(),randomUUID()+randomUUID(),randomUUID(),'1'.repeat(32)]);
  await w.admin.query("INSERT INTO order_authority(merchant_id,order_id,source_kind,source_account_id,source_branch_id,source_label_snapshot,serving_kind,serving_label_snapshot,quote_id,price_version_id,catalog_currency,catalog_decimals,total_minor,settlement) VALUES($1,$2,'online',$6,$7,'t','pickup','t',$3,$4,'USD',2,$5,'{}')",[w.merchant,order,randomUUID(),price,900,account,branch]);
  await w.admin.query("INSERT INTO online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_deadline) VALUES($1,$2,$3,$4,now()+interval '1 day')",[w.merchant,order,account,branch]);
  await w.admin.query("SET session_replication_role='origin'");
  const chain=worker.createLoyaltyChain(signers);
  await worker.tickLoyaltyMerchant(w.merchant,chain);
  const [row]=await w.rows();assert.equal(row.status,'CONFIRMED');assert.ok(row.signature);
  assert.equal(await chainLib.badgeBalance(connection,mint,holder),1n,'the wallet really holds the badge');
  assert.equal((await chainLib.inspectTierMint(connection,mint)).nonTransferable,true);
  await w.refund(order);
  await worker.tickLoyaltyMerchant(w.merchant,chain);
  assert.equal((await w.rows())[0].status,'REVOKED');assert.equal(await chainLib.badgeBalance(connection,mint,holder),0n,'the badge is gone after the refund');
  console.log(JSON.stringify({devnetMint:mint,createSignature:signature,issueSignature:row.signature}));
 }finally{await w.close();}
});
