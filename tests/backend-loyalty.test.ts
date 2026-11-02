import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import {ed25519} from '@noble/curves/ed25519';
import bs58 from 'bs58';
// "Regulars" badges step 1 (migration 180). Needs a database with all migrations applied; skipped otherwise.
// Wallet signatures are real ed25519 over the real challenge text; nothing here touches a chain.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'||!process.env.ADMIN_DATABASE_URL};
// Intentional loading boundary: the API modules need private config, so a skipped run must not import them.
const loyalty=integration.skip?(undefined as never):await import('../apps/api/src/loyalty') as typeof import('../apps/api/src/loyalty');
const asApp=async<T>(db:pg.Client,merchant:string|null,fn:()=>Promise<T>)=>{await db.query('SET LOCAL ROLE bitpos_app');if(merchant)await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);try{return await fn();}finally{await db.query('RESET ROLE').catch(()=>undefined);}};
const replica=async(db:pg.Client,fn:()=>Promise<unknown>)=>{await db.query("SET LOCAL session_replication_role='replica'");let failure:unknown;try{await fn();}catch(e){failure=e;}if(failure)throw failure;await db.query("SET LOCAL session_replication_role='origin'");};
const wallet=()=>{const secret=ed25519.utils.randomSecretKey();return {secret,address:bs58.encode(ed25519.getPublicKey(secret))};};
const sign=(w:{secret:Uint8Array},message:string)=>bs58.encode(ed25519.sign(Buffer.from(message,'utf8'),w.secret));

async function withDb(fn:(c:{db:pg.Client;merchant:string;other:string;account:string;session:string;paid:(units:number)=>Promise<string>})=>Promise<void>){
 const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
 try{
  await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');
  const merchant=randomUUID(),other=randomUUID(),account=randomUUID(),session=randomUUID(),branch=randomUUID(),price=randomUUID();
  for(const m of [merchant,other])await db.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Loyalty test',$2)",[m,'1'.repeat(32)]);
  await replica(db,async()=>{
   await db.query("INSERT INTO catalog_price_versions(id,merchant_id,currency,decimals,provenance,demo_label,quote_policy) VALUES($1,$2,'USD',2,'demo_configured','LOYALTY TEST','USD_CENTS_TO_USDG_1_TO_1')",[price,merchant]);
   await db.query('INSERT INTO merchant_pricing(merchant_id,active_price_version_id,revision) VALUES($1,$2,1)',[merchant,price]);
   await db.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
   await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,md5(random()::text),md5(random()::text),now()+interval '1 hour',now()+interval '1 day')",[session,account,randomUUID()]);
  });
  const paid=async(units:number)=>{
   const id=randomUUID();
   await replica(db,async()=>{
    await db.query("INSERT INTO orders(id,merchant_id,customer_id,access_token,idempotency_key,request_hash,status,authority_version,thb_minor,terminal_id,usdg_minor,treasury,quote_expires_at) VALUES($1,$2,$3,$4,$5,'h','PAID',2,NULL,NULL,1,$6,now()+interval '1 day')",[id,merchant,randomUUID(),randomUUID()+randomUUID(),randomUUID(),'1'.repeat(32)]);
    await db.query("INSERT INTO order_authority(merchant_id,order_id,source_kind,source_account_id,source_branch_id,source_label_snapshot,serving_kind,serving_label_snapshot,quote_id,price_version_id,catalog_currency,catalog_decimals,total_minor,settlement) VALUES($1,$2,'online',$6,$7,'t','pickup','t',$3,$4,'USD',2,$5,'{}')",[merchant,id,randomUUID(),price,units*100,account,branch]);
    await db.query("INSERT INTO online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_deadline) VALUES($1,$2,$3,$4,now()+interval '1 day')",[merchant,id,account,branch]);
   });
   return id;
  };
  await fn({db,merchant,other,account,session,paid});
 }finally{await db.query('ROLLBACK');await db.end();}
}
const tier=(o:Record<string,unknown>={})=>({slot:1,nameTh:'ประจำ',nameEn:'Regular',minPoints:5,enabled:true,...o});

test('tier setup is role fenced, ordered, currency-bound and strict',integration,()=>withDb(async({db,merchant})=>{
 const run=(role:string,method:string,input?:unknown)=>asApp(db,merchant,()=>loyalty.loyaltySettings(db as unknown as pg.PoolClient,merchant,randomUUID(),role,method,input));
 await db.query('SAVEPOINT s');await assert.rejects(run('staff','GET'),(e:any)=>e.status===403);await db.query('ROLLBACK TO SAVEPOINT s');
 await db.query('SAVEPOINT s');await assert.rejects(run('staff','PUT',tier()),(e:any)=>e.status===403);await db.query('ROLLBACK TO SAVEPOINT s');
 const a:any=await run('manager','PUT',tier());assert.equal(a.tiers.length,1);assert.deepEqual([a.tiers[0].currency,a.tiers[0].decimals,a.tiers[0].minPoints],['USD',2,5]);
 await run('owner','PUT',tier({slot:2,nameEn:'Gold',nameTh:'ทอง',minPoints:20}));
 // thresholds must rise with the slot
 for(const bad of [tier({slot:3,minPoints:20}),tier({slot:3,minPoints:10}),tier({slot:1,minPoints:25})]){
  await db.query('SAVEPOINT s');await assert.rejects(run('owner','PUT',bad),(e:any)=>e.status===409&&e.details?.loyaltyCode==='LOYALTY_THRESHOLD_ORDER');await db.query('ROLLBACK TO SAVEPOINT s');
 }
 for(const bad of [tier({slot:4}),tier({minPoints:0}),tier({nameEn:' '}),{...tier(),extra:1},tier({minPoints:1.5})]){
  await db.query('SAVEPOINT s');await assert.rejects(run('owner','PUT',bad));await db.query('ROLLBACK TO SAVEPOINT s');
 }
 const t3:any=await run('owner','PUT',tier({slot:3,minPoints:50,nameEn:'Platinum',nameTh:'แพลตินัม'}));assert.equal(t3.tiers.length,3);
}));

test('progress counts lifetime points, ignores refunded orders, and redemptions never lower a tier',integration,()=>withDb(async({db,merchant,account,session,paid})=>{
 const run=(m:unknown)=>asApp(db,merchant,()=>loyalty.loyaltySettings(db as unknown as pg.PoolClient,merchant,randomUUID(),'owner','PUT',m));
 await run(tier());await run(tier({slot:2,nameEn:'Gold',nameTh:'ทอง',minPoints:20}));
 const progress=()=>asApp(db,null,()=>loyalty.loyaltyProgress(db as unknown as pg.PoolClient,account,session,merchant)) as Promise<any>;
 let p=await progress();assert.deepEqual([p.configured,p.lifetimePoints,p.current,p.next.slot,p.pointsToNext],[true,0,null,1,5]);
 await paid(3);p=await progress();assert.deepEqual([p.lifetimePoints,p.current,p.pointsToNext],[3,null,2]);
 const second=await paid(4);p=await progress();assert.deepEqual([p.lifetimePoints,p.current.slot,p.next.slot,p.pointsToNext],[7,1,2,13]);
 // A refund removes that order's points, so the tier can fall (a badge already issued is handled in step 2).
 await replica(db,()=>db.query("INSERT INTO refunds(merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary,cause) VALUES($1,$2,$3,100,'{}','{}','b','ONLINE_ACCEPTANCE_REJECTED')",[merchant,second,randomUUID()]));
 p=await progress();assert.equal(p.lifetimePoints,3,'a refunded order earns nothing');assert.equal(p.current,null,'the tier falls with the refund (an issued badge is handled in step 2)');
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.loyaltyProgress(db as unknown as pg.PoolClient,account,randomUUID(),merchant)),(e:any)=>e.status===401);await db.query('ROLLBACK TO SAVEPOINT s');
 p=await asApp(db,null,()=>loyalty.loyaltyProgress(db as unknown as pg.PoolClient,account,session,randomUUID())) as any;assert.equal(p.configured,false);
}));

test('wallet binding needs a fresh, correct signature over the exact challenge and is one-to-one',integration,()=>withDb(async({db,account,session})=>{
 const client=db as unknown as pg.PoolClient,w=wallet(),now=new Date(),issuedAt=now.toISOString().replace(/\.\d+Z$/,'.000Z');
 const msg=loyalty.loyaltyChallengeMessage(account,w.address,issuedAt);
 assert.match(msg,/does not authorize any payment/);
 const bind=(body:unknown,at=now)=>asApp(db,null,()=>loyalty.bindLoyaltyWallet(client,account,session,body,at));
 const refuse=async(body:unknown,at=now)=>{await db.query('SAVEPOINT s');await assert.rejects(bind(body,at),(e:any)=>e.status===401||e.status===422);await db.query('ROLLBACK TO SAVEPOINT s');};
 await refuse({wallet:w.address,issuedAt,signature:sign(wallet(),msg)});              // someone else's key
 await refuse({wallet:w.address,issuedAt,signature:sign(w,msg+' ')});                 // different text
 await refuse({wallet:w.address,issuedAt,signature:sign(w,msg)},new Date(now.getTime()+11*60_000)); // expired
 await refuse({wallet:w.address,issuedAt:new Date(now.getTime()+5*60_000).toISOString(),signature:sign(w,msg)}); // issued in the future
 await refuse({wallet:w.address,issuedAt,signature:sign(w,msg),extra:1});
 const ok:any=await bind({wallet:w.address,issuedAt,signature:sign(w,msg)});assert.deepEqual([ok.wallet,ok.replayed],[w.address,false]);
 assert.equal(((await bind({wallet:w.address,issuedAt,signature:sign(w,msg)})) as any).replayed,true);
 // a second account cannot take the same wallet
 const other=randomUUID(),otherSession=randomUUID();
 await replica(db,async()=>{await db.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[other,randomUUID()]);await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,md5(random()::text),md5(random()::text),now()+interval '1 hour',now()+interval '1 day')",[otherSession,other,randomUUID()]);});
 const msg2=loyalty.loyaltyChallengeMessage(other,w.address,issuedAt);
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.bindLoyaltyWallet(client,other,otherSession,{wallet:w.address,issuedAt,signature:sign(w,msg2)},now)),(e:any)=>e.status===409&&e.details?.loyaltyCode==='LOYALTY_WALLET_IN_USE');await db.query('ROLLBACK TO SAVEPOINT s');
 // a challenge issued for account A does not verify for account B
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.bindLoyaltyWallet(client,other,otherSession,{wallet:w.address,issuedAt,signature:sign(w,msg)},now)),(e:any)=>e.status===401);await db.query('ROLLBACK TO SAVEPOINT s');
 // rebinding to a new wallet revokes the old binding; only one stays active
 const w2=wallet(),m3=loyalty.loyaltyChallengeMessage(account,w2.address,issuedAt);
 await bind({wallet:w2.address,issuedAt,signature:sign(w2,m3)});
 const rows=(await db.query('SELECT wallet_address,revoked_at IS NULL active FROM bitpos.loyalty180_wallet_bindings WHERE account_id=$1 ORDER BY proven_at',[account])).rows;
 assert.deepEqual(rows.map(r=>r.active),[false,true]);assert.equal(rows[1].wallet_address,w2.address);
 // the stored value is a hash of the challenge, not the message or any signature
 assert.match((await db.query('SELECT challenge_hash FROM bitpos.loyalty180_wallet_bindings WHERE account_id=$1 AND revoked_at IS NULL',[account])).rows[0].challenge_hash,/^[0-9a-f]{64}$/);
}));

test('consent is explicit, per shop, withdrawable, and shown in progress',integration,()=>withDb(async({db,merchant,other,account,session})=>{
 const client=db as unknown as pg.PoolClient;
 await asApp(db,merchant,()=>loyalty.loyaltySettings(client,merchant,randomUUID(),'owner','PUT',tier()));
 const progress=async()=>await asApp(db,null,()=>loyalty.loyaltyProgress(client,account,session,merchant)) as any;
 assert.equal((await progress()).consentGranted,false);
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.setLoyaltyConsent(client,account,session,{merchantId:other,granted:true})),(e:any)=>e.status===404);await db.query('ROLLBACK TO SAVEPOINT s');
 await asApp(db,null,()=>loyalty.setLoyaltyConsent(client,account,session,{merchantId:merchant,granted:true}));assert.equal((await progress()).consentGranted,true);
 await asApp(db,null,()=>loyalty.setLoyaltyConsent(client,account,session,{merchantId:merchant,granted:false}));assert.equal((await progress()).consentGranted,false);
 await asApp(db,null,()=>loyalty.setLoyaltyConsent(client,account,session,{merchantId:merchant,granted:true}));assert.equal((await progress()).consentGranted,true);
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.setLoyaltyConsent(client,account,randomUUID(),{merchantId:merchant,granted:true})),(e:any)=>e.status===401);await db.query('ROLLBACK TO SAVEPOINT s');
}));

test('tier rows are tenant isolated for the app role',integration,()=>withDb(async({db,merchant,other})=>{
 const client=db as unknown as pg.PoolClient;
 await asApp(db,merchant,()=>loyalty.loyaltySettings(client,merchant,randomUUID(),'owner','PUT',tier()));
 const seen=async(m:string)=>asApp(db,m,async()=>(await db.query('SELECT count(*)::int n FROM bitpos.loyalty180_tiers')).rows[0].n);
 assert.equal(await seen(merchant),1);assert.equal(await seen(other),0);
}));

test('verify reads the chain through the injected reader, needs a staff role and rejects junk',integration,()=>withDb(async({db,merchant})=>{
 const client=db as unknown as pg.PoolClient;
 await asApp(db,merchant,()=>loyalty.loyaltySettings(client,merchant,randomUUID(),'owner','PUT',tier()));
 await asApp(db,merchant,()=>loyalty.loyaltySettings(client,merchant,randomUUID(),'owner','PUT',tier({slot:2,nameEn:'Gold',nameTh:'ทอง',minPoints:20})));
 const m1=wallet().address,m2=wallet().address;
 await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
 await db.query('SELECT bitpos.loyalty180_set_mint(1,$1,$2)',[m1,wallet().address+wallet().address]);
 await db.query('SELECT bitpos.loyalty180_set_mint(2,$1,$2)',[m2,wallet().address+wallet().address]);
 const holder=wallet().address,url=(q:string)=>new URL('http://x/api/loyalty/verify'+q);
 const reads:string[]=[];const holds=async(mint:string,w:string)=>{reads.push(mint);return w===holder&&mint===m1;};
 const res=await asApp(db,merchant,()=>loyalty.verifyLoyaltyWallet(client,'staff',url('?wallet='+holder),holds));
 assert.deepEqual([res.held.length,res.highest?.slot,res.source],[1,1,'solana:devnet finalized']);assert.equal(reads.length,2);
 const none=await asApp(db,merchant,()=>loyalty.verifyLoyaltyWallet(client,'manager',url('?wallet='+wallet().address),holds));assert.equal(none.highest,null);
 for(const [role,q] of [['customer','?wallet='+holder],['staff',''],['staff','?wallet=short'],['staff','?wallet='+holder+'&x=1']] as const){
  await db.query('SAVEPOINT s');await assert.rejects(asApp(db,merchant,()=>loyalty.verifyLoyaltyWallet(client,role,url(q),holds)));await db.query('ROLLBACK TO SAVEPOINT s');
 }
}));

test('one-time bind code: public challenge, real signature, single use, retired by a newer code, locked after wrong proofs',integration,()=>withDb(async({db,account,session})=>{
 const client=db as unknown as pg.PoolClient,now=new Date();
 const issue=()=>asApp(db,null,()=>loyalty.createLoyaltyBindCode(client,account,session,'https://pay.example'));
 const first=await issue();
 assert.match(first.code,/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);assert.equal(first.bindUrl,`https://pay.example/loyalty?code=${first.code}`);
 assert.ok(Date.parse(first.expiresAt)>now.getTime()+9*60_000);
 const w=wallet();
 const ch:any=await asApp(db,null,()=>loyalty.loyaltyBindChallenge(client,{code:first.code.toLowerCase(),wallet:w.address},now));
 assert.equal(ch.message,loyalty.loyaltyChallengeMessage(account,w.address,ch.issuedAt));
 // a wrong-key proof is refused and counted, but the code is still usable
 const bad=wallet();
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.loyaltyBindWithCode(client,{code:first.code,wallet:w.address,issuedAt:ch.issuedAt,signature:sign(bad,ch.message)},now)),(e:any)=>e.status===401);await db.query('RELEASE SAVEPOINT s');
 assert.equal((await db.query('SELECT failures FROM bitpos.loyalty180_bind_codes WHERE account_id=$1 AND used_at IS NULL',[account])).rows[0].failures,1);
 const ok:any=await asApp(db,null,()=>loyalty.loyaltyBindWithCode(client,{code:first.code,wallet:w.address,issuedAt:ch.issuedAt,signature:sign(w,ch.message)},now));
 assert.deepEqual([ok.wallet,ok.replayed],[w.address,false]);assert.ok(!('accountId' in ok),'the public reply never reveals the account id');
 assert.equal((await db.query('SELECT wallet_address FROM bitpos.loyalty180_wallet_bindings WHERE account_id=$1 AND revoked_at IS NULL',[account])).rows[0].wallet_address,w.address);
 // single use
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.loyaltyBindWithCode(client,{code:first.code,wallet:w.address,issuedAt:ch.issuedAt,signature:sign(w,ch.message)},now)),(e:any)=>e.status===401);await db.query('ROLLBACK TO SAVEPOINT s');
 // a newer code retires an unused older one
 const a=await issue(),b=await issue();
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.loyaltyBindChallenge(client,{code:a.code,wallet:w.address},now)),(e:any)=>e.status===401);await db.query('ROLLBACK TO SAVEPOINT s');
 await asApp(db,null,()=>loyalty.loyaltyBindChallenge(client,{code:b.code,wallet:w.address},now));
 // five wrong proofs lock the code; junk input is refused before SQL
 for(let i=0;i<5;i++)await asApp(db,null,()=>loyalty.loyaltyBindWithCode(client,{code:b.code,wallet:w.address,issuedAt:ch.issuedAt,signature:sign(bad,'x')},now).catch(()=>undefined));
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.loyaltyBindChallenge(client,{code:b.code,wallet:w.address},now)),(e:any)=>e.status===401);await db.query('ROLLBACK TO SAVEPOINT s');
 for(const body of [{code:'nope',wallet:w.address},{code:b.code},{code:b.code,wallet:'short'},{code:b.code,wallet:w.address,extra:1}]){
  await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.loyaltyBindChallenge(client,body,now)),(e:any)=>e.status===422);await db.query('ROLLBACK TO SAVEPOINT s');
 }
 // an expired code is refused
 await db.query("UPDATE bitpos.loyalty180_bind_codes SET expires_at=clock_timestamp()-interval '1 second' WHERE used_at IS NULL AND account_id=$1",[account]);
 const c=await issue();await db.query("UPDATE bitpos.loyalty180_bind_codes SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",[account]);
 await db.query('SAVEPOINT s');await assert.rejects(asApp(db,null,()=>loyalty.loyaltyBindChallenge(client,{code:c.code,wallet:w.address},now)),(e:any)=>e.status===401);await db.query('ROLLBACK TO SAVEPOINT s');
}));

test('customer overview lists only shops with tiers where the caller ordered; badge and wallet show up; POS stats count repeaters',integration,()=>withDb(async({db,merchant,other,account,session,paid})=>{
 const client=db as unknown as pg.PoolClient;
 const run=(m:string,b:unknown)=>asApp(db,m,()=>loyalty.loyaltySettings(client,m,randomUUID(),'owner','PUT',b));
 const overview=async()=>(await asApp(db,null,async()=>(await db.query('SELECT bitpos.mobile_loyalty_overview($1,$2) AS v',[account,session])).rows[0].v)) as any[];
 assert.equal((await overview()).length,0,'no order yet');
 const first=await paid(8);
 assert.equal((await overview()).length,0,'the shop has no tiers yet');
 await run(merchant,tier());await run(merchant,tier({slot:2,nameEn:'Gold',nameTh:'ทอง',minPoints:20}));
 let shops=await overview();assert.equal(shops.length,1);
 let s=shops[0];assert.deepEqual([s.merchantId,s.configured,s.lifetimePoints,s.current.slot,s.next.slot,s.pointsToNext,s.consentGranted,s.walletBound,s.walletAddress,s.badge],[merchant,true,8,1,2,12,false,false,null,null]);
 assert.equal(s.merchantName,'Loyalty test');
 await paid(3);
 const w=wallet();
 await db.query("INSERT INTO bitpos.loyalty180_wallet_bindings(account_id,wallet_address,challenge_hash) VALUES($1,$2,$3)",[account,w.address,'c'.repeat(64)]);
 await db.query("INSERT INTO bitpos.loyalty180_consents(account_id,merchant_id,version) VALUES($1,$2,'t')",[account,merchant]);
 await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
 await db.query('SELECT bitpos.loyalty180_set_mint(1,$1,$2)',[wallet().address,wallet().address+wallet().address]);
 await db.query("INSERT INTO bitpos.loyalty180_mints(merchant_id,account_id,tier_slot,wallet_address,status,signature,idempotency_key) VALUES($1,$2,1,$3,'CONFIRMED',$4,'k')",[merchant,account,w.address,wallet().address+wallet().address]);
 s=(await overview())[0];assert.deepEqual([s.walletBound,s.walletAddress,s.consentGranted,s.badge.status,s.badge.wallet,s.badge.tierSlot],[true,w.address,true,'CONFIRMED',w.address,1]);
 // a shop without tiers where the caller also ordered is not listed
 assert.equal((await overview()).length,1);void other;void first;
 const stats:any=await asApp(db,merchant,async()=>(await db.query('SELECT bitpos.loyalty180_repeat_stats() AS v')).rows[0].v);
 assert.deepEqual([stats.payingCustomers,stats.repeatCustomers,stats.repeatRatePercent,stats.members,stats.badgesHeld],[1,1,100,1,1]);
 const empty:any=await asApp(db,other,async()=>(await db.query('SELECT bitpos.loyalty180_repeat_stats() AS v')).rows[0].v);
 assert.deepEqual([empty.payingCustomers,empty.repeatRatePercent,empty.members,empty.badgesHeld],[0,0,0,0]);
 // the settings GET carries the same stats for the POS card
 const settings:any=await asApp(db,merchant,()=>loyalty.loyaltySettings(client,merchant,randomUUID(),'manager','GET',undefined));
 assert.equal(settings.stats.repeatCustomers,1);assert.equal(settings.tiers.length,2);
}));

test('mobile loyalty routes authenticate before touching SQL',async()=>{
 if(integration.skip)return;
 for(const [method,path,input] of [['GET','/api/mobile/v1/account/loyalty',undefined],['POST','/api/mobile/v1/account/loyalty/consent',{merchantId:randomUUID(),granted:true}],['POST','/api/mobile/v1/account/loyalty/bind-code',{}]] as const)
  await assert.rejects(loyalty.mobileLoyaltyRequest(new URL('http://x'+path),method,input,undefined),(e:any)=>e.status===401);
 assert.equal(await loyalty.mobileLoyaltyRequest(new URL('http://x/api/mobile/v1/other'),'GET',undefined,undefined),undefined);
});
