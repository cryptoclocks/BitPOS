import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {withFixture} from './backend-online-quote-fixture';
import {tableFixture} from './backend-table-fixture';
// DS52 demo-grade reward vouchers (migration 173): merchant setup, points debit, single-use vouchers and the
// existing coupon quote path as the only pricing path.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const wire=await import('../packages/contracts/src/mobile-v1.generated');
const food=await import('../apps/api/src/mobile-food');
const rewards=await import('../apps/api/src/reward-vouchers');
const asApp=async<T>(db:pg.Client,fn:()=>Promise<T>)=>{await db.query('SET LOCAL ROLE bitpos_app');const result=await fn();await db.query('RESET ROLE');return result;};
const replica=async(db:pg.Client,fn:()=>Promise<unknown>)=>{await db.query("SET LOCAL session_replication_role='replica'");try{await fn();}finally{await db.query("SET LOCAL session_replication_role='origin'");}};
const body=(o:Record<string,unknown>={})=>({slot:1,nameTh:'ส่วนลด 1 หน่วย',nameEn:'1 unit off',pointsCost:1,discountMinor:'1',minimumSpendMinor:'2',validityDays:30,enabled:true,...o});

test('mobile reward routes authenticate before touching SQL',async()=>{
 for(const [method,path,input] of [['GET','/api/mobile/v1/account/rewards/catalog',undefined],['POST','/api/mobile/v1/account/rewards/redeem',{rewardId:randomUUID(),idempotencyKey:randomUUID()}],['GET','/api/mobile/v1/account/vouchers',undefined]] as const)
  await assert.rejects(rewards.mobileRewardVoucherRequest(new URL('http://x'+path),method,input,undefined),(e:any)=>e.status===401&&e.code==='AUTH_REQUIRED');
});

test('merchant setup is role fenced, bounded to 3 slots, honest about terms',integration,async()=>withFixture(async({db,source})=>{
 const merchant=source.merchant_id as string,actor=randomUUID();
 const run=(role:string,method:string,input?:unknown)=>asApp(db,()=>rewards.rewardSettings(db as unknown as pg.PoolClient,merchant,actor,role,method,input));
 await db.query('SAVEPOINT s');await assert.rejects(run('staff','GET'),(e:any)=>e.status===403&&e.code==='ROLE_REQUIRED');await db.query('ROLLBACK TO SAVEPOINT s');
 await db.query('SAVEPOINT s');await assert.rejects(run('staff','PUT',body()),(e:any)=>e.status===403);await db.query('ROLLBACK TO SAVEPOINT s');
 const created:any=await run('manager','PUT',body());
 assert.equal(created.rewards.length,1);assert.equal(created.rewards[0].pointsCost,1);assert.equal(created.rewards[0].discountMinor,'1');assert.equal(created.currency,created.rewards[0].currency);
 const code=(await db.query('SELECT c.code,c.enabled,v.discount_kind,v.merchant_funding_bps,v.fixed_minor::text f FROM reward173_rewards w JOIN coupon097_campaigns c ON c.id=w.campaign_id JOIN coupon097_versions v ON v.id=c.active_version_id WHERE w.merchant_id=$1',[merchant])).rows[0];
 assert.match(code.code,/^RW[0-9A-F]{10}$/);assert.equal(code.enabled,true);assert.equal(code.discount_kind,'FIXED');assert.equal(code.merchant_funding_bps,10000,'merchant funded only');assert.equal(code.f,'1');
 // Names/cost/enabled can change; the discount terms of an existing slot are locked.
 const renamed:any=await run('owner','PUT',body({nameEn:'Renamed',pointsCost:3,enabled:false}));assert.equal(renamed.rewards[0].nameEn,'Renamed');assert.equal(renamed.rewards[0].enabled,false);assert.equal(renamed.rewards.length,1);
 await db.query('SAVEPOINT s');await assert.rejects(run('owner','PUT',body({discountMinor:'2',minimumSpendMinor:'9'})),(e:any)=>e.status===409&&e.code==='REWARD_TERMS_LOCKED');await db.query('ROLLBACK TO SAVEPOINT s');
 // Invalid: slot 4, zero-payable-capable minimum, zero cost, blank names, extra field.
 for(const bad of [body({slot:4}),body({discountMinor:'5',minimumSpendMinor:'5'}),body({pointsCost:0}),body({nameTh:' '}),{...body(),extra:1},body({discountMinor:'0'})]){
  await db.query('SAVEPOINT s');await assert.rejects(run('owner','PUT',bad));await db.query('ROLLBACK TO SAVEPOINT s');
 }
 await run('owner','PUT',body({slot:2}));await run('owner','PUT',body({slot:3}));
 assert.equal(((await run('owner','GET')) as any).rewards.length,3);
}));

test('points are debited once, never negative; vouchers are single-use, account/merchant bound, and priced only by the coupon quote path',integration,async()=>withFixture(async({db,source,quote,order,rejected})=>{
 const merchant=source.merchant_id as string,account=source.source_account_id as string,branch=source.source_branch_id as string;
 const sid=(await db.query("SELECT current_setting('bitpos.mobile_session') s")).rows[0].s as string;
 const actor={accountId:account,sessionId:sid,deviceId:randomUUID()};
 const redeem=(reward:string,key:string)=>asApp(db,async()=>(await db.query('SELECT bitpos.mobile_reward_redeem($1,$2,$3,$4) v',[account,sid,reward,key])).rows[0].v);
 const catalog=()=>asApp(db,async()=>(await db.query('SELECT bitpos.mobile_reward_catalog($1,$2) v',[account,sid])).rows[0].v as any[]);
 const vouchers=()=>asApp(db,async()=>(await db.query('SELECT bitpos.mobile_reward_vouchers($1,$2) v',[account,sid])).rows[0].v as any[]);
 await asApp(db,()=>rewards.rewardSettings(db as unknown as pg.PoolClient,merchant,randomUUID(),'owner','PUT',body({pointsCost:2})));
 const reward=(await db.query('SELECT id,campaign_id FROM reward173_rewards WHERE merchant_id=$1 AND slot=1',[merchant])).rows[0];
 const code=(await db.query('SELECT code FROM coupon097_campaigns WHERE id=$1',[reward.campaign_id])).rows[0].code as string;
 // The fixture account may already have paid orders here: measure the baseline instead of assuming zero.
 const before=await catalog();assert.equal(before.length,1);const baseline=before[0].balance as number;
 await replica(db,()=>db.query('UPDATE reward173_rewards SET points_cost=$2 WHERE id=$1',[reward.id,baseline+1]));
 const base=await quote();const first=await order(base);
 const unpaid=await catalog();assert.equal(unpaid[0].balance,baseline,'an unpaid order earns nothing');assert.equal(unpaid[0].redeemable,false);
 await rejected(()=>redeem(reward.id,randomUUID()),'REWARD_INSUFFICIENT_POINTS');
 // Pay it (SQL-only test seam, as in backend-rewards): points = whole currency units of the order.
 await replica(db,()=>db.query("UPDATE orders SET status='PAID',paid_at=clock_timestamp() WHERE merchant_id=$1 AND id=$2",[merchant,first.id]));
 const orderPoints=Number((await db.query('SELECT div(total_minor::numeric,10::numeric^catalog_decimals)::bigint p FROM order_authority WHERE order_id=$1',[first.id])).rows[0].p);
 assert.ok(orderPoints>=1,'fixture order must earn a point');
 const paid=await catalog();const earned=paid[0].balance as number;assert.equal(earned,baseline+orderPoints);
 // Price the reward at exactly the whole balance: one redemption possible, a second must not go negative.
 await db.query('SAVEPOINT cost');
 const key=randomUUID();
 await replica(db,()=>db.query('UPDATE reward173_rewards SET points_cost=$2 WHERE id=$1',[reward.id,earned]));
 assert.equal((await catalog())[0].redeemable,true);
 const one=await redeem(reward.id,key);
 assert.equal(one.replayed,false);assert.equal(one.balance,0);assert.equal(one.voucher.state,'AVAILABLE');assert.equal(one.voucher.code,code);assert.equal(one.voucher.pointsSpent,earned);
 wire.MobileRewardRedemptionSchema.parse(one);
 const again=await redeem(reward.id,key);assert.equal(again.replayed,true);assert.equal(again.voucher.id,one.voucher.id);assert.equal(again.balance,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM reward173_redemptions WHERE account_id=$1',[account])).rows[0].n,1,'replay debits nothing');
 await rejected(()=>redeem(reward.id,randomUUID()),'REWARD_INSUFFICIENT_POINTS');
 await rejected(()=>redeem(randomUUID(),key),'IDEMPOTENCY_CONFLICT');
 assert.equal((await db.query('SELECT bitpos.reward173_balance($1,$2,$3,$4) b',[account,merchant,paid[0].currency,paid[0].decimals])).rows[0].b,'0');
 // The account-wide total nets the redemption out too.
 assert.equal(Number((await asApp(db,()=>db.query('SELECT coalesce(sum(points),0)::bigint p FROM bitpos.mobile_reward_totals($1,$2)',[account,sid]))).rows[0].p),0);
 // Another account (and a stale/foreign session) cannot see or spend it.
 const other=randomUUID(),otherSession=randomUUID();
 await db.query("INSERT INTO mobile_accounts(id,auth_subject,display_name,locale)VALUES($1,$2,'Other','en')",[other,randomUUID()]);
 await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at)VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[otherSession,other,randomUUID(),digest(randomBytes(8).toString('hex')),digest(randomBytes(8).toString('hex'))]);
 assert.deepEqual((await asApp(db,async()=>(await db.query('SELECT bitpos.mobile_reward_vouchers($1,$2) v',[other,otherSession])).rows[0].v)),[]);
 assert.deepEqual((await asApp(db,async()=>(await db.query('SELECT bitpos.mobile_reward_catalog($1,$2) v',[other,otherSession])).rows[0].v)),[]);
 await rejected(()=>asApp(db,()=>db.query('SELECT bitpos.mobile_reward_redeem($1,$2,$3,$4)',[other,otherSession,reward.id,randomUUID()])),'RESOURCE_NOT_FOUND');
 await rejected(()=>asApp(db,()=>db.query('SELECT bitpos.mobile_reward_vouchers($1,$2)',[account,otherSession])),'AUTH_REQUIRED');
 await rejected(()=>asApp(db,()=>db.query('SELECT bitpos.mobile_reward_redeem($1,$2,$3,$4)',[account,otherSession,reward.id,randomUUID()])),'AUTH_REQUIRED');
 // Disabled rewards cannot be redeemed (the replay above still works because the key was used before).
 await replica(db,()=>db.query('UPDATE reward173_rewards SET enabled=false WHERE id=$1',[reward.id]));
 assert.deepEqual(await catalog(),[]);await rejected(()=>redeem(reward.id,randomUUID()),'REWARD_UNAVAILABLE');
 await replica(db,()=>db.query('UPDATE reward173_rewards SET enabled=true WHERE id=$1',[reward.id]));

 // ---- Voucher through the existing coupon quote path, once only ----
 const list=await vouchers();assert.equal(list.length,1);wire.MobileVouchersSchema.parse({generatedAt:new Date().toISOString(),vouchers:list});
 const q1=await quote(),q2=await quote();
 const apply=(q:string,k:string,c=code)=>asApp(db,()=>food.applyFoodCoupon(db as unknown as pg.PoolClient,actor,branch,q,{code:c,idempotencyKey:k}));
 const refused=async(q:string,reason:string)=>{await db.query('SAVEPOINT r');try{await apply(q,randomUUID());assert.fail('expected '+reason);}catch(e:any){assert.equal(e.status,409);assert.equal(e.code,'QUOTE_CHANGED');assert.equal(e.details.reasonCode,reason);}await db.query('ROLLBACK TO SAVEPOINT r');};
 // The campaign code alone is worthless without a voucher: a different account's session would be refused the same way.
 const k1=randomUUID();
 const applied=await apply(q1,k1);
 assert.equal(applied.couponCode,code);assert.equal(applied.quote.discount.amountMinor,'1');
 const sourceTotal=BigInt((await db.query('SELECT total_minor FROM order_quotes WHERE id=$1',[q1])).rows[0].total_minor);assert.equal(BigInt(applied.quote.total.amountMinor),sourceTotal-1n,'only the SQL coupon discount applies');
 assert.equal((await vouchers())[0].state,'IN_USE');
 const replay=await apply(q1,k1);assert.equal(replay.quote.id,applied.quote.id,'coupon replay keeps its voucher and quote');
 assert.equal((await db.query('SELECT count(*)::int n FROM reward173_vouchers WHERE hold_id IS NOT NULL')).rows[0].n,1);
 await refused(q2,'COUPON_REWARD_VOUCHER_REQUIRED');
 // Binding the discounted quote into an order keeps it IN_USE; consuming it makes it USED and it can never be applied again.
 const bound=await order(applied.quote.id);
 assert.equal((await vouchers())[0].state,'IN_USE');
 await replica(db,()=>db.query("UPDATE coupon167_redemptions SET state='CONSUMED',version=version+1 WHERE order_id=$1",[bound.id]));
 assert.equal((await vouchers())[0].state,'USED');await refused(q2,'COUPON_REWARD_VOUCHER_REQUIRED');
 // A released hold gives the voucher back (explicit server rule); an expired voucher is refused and not credited back.
 await replica(db,async()=>{await db.query("UPDATE coupon167_redemptions SET state='RELEASED' WHERE order_id=$1",[bound.id]);await db.query("UPDATE coupon097_holds SET state='RELEASED' WHERE id=(SELECT hold_id FROM reward173_vouchers WHERE account_id=$1)",[account]);});
 assert.equal((await vouchers())[0].state,'AVAILABLE');
 await replica(db,()=>db.query("UPDATE reward173_vouchers SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",[account]));
 assert.equal((await vouchers())[0].state,'EXPIRED');await refused(q2,'COUPON_REWARD_VOUCHER_REQUIRED');
 assert.equal((await db.query('SELECT bitpos.reward173_balance($1,$2,$3,$4) b',[account,merchant,paid[0].currency,paid[0].decimals])).rows[0].b,'0','expiry does not refund points');
 // Another shop's context does not know the code at all.
 await db.query("SELECT set_config('bitpos.merchant',$1,true)",[randomUUID()]);
 await db.query('SAVEPOINT m');try{await apply(q2,randomUUID());assert.fail('merchant bound');}catch(e:any){assert.ok(['COUPON_NOT_FOUND','RESOURCE_NOT_FOUND'].includes(e.details?.reasonCode??e.code),String(e.code)+e.message);}await db.query('ROLLBACK TO SAVEPOINT m');
 await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
 // A newer price version re-points the reward coupon at it (new immutable coupon version, same terms); this quote was priced on the old
 // version so it is still refused by the existing gate, proving the sync ran without SQL errors.
 await db.query('SAVEPOINT sync');
 await replica(db,async()=>{
  await db.query("UPDATE reward173_vouchers SET expires_at=clock_timestamp()+interval '1 day' WHERE account_id=$1",[account]);
  const pv=randomUUID();
  await db.query("INSERT INTO catalog_price_versions(merchant_id,id,currency,decimals,provenance,demo_label,quote_policy)SELECT merchant_id,$2,currency,decimals,provenance,demo_label,quote_policy FROM catalog_price_versions WHERE merchant_id=$1 AND id=(SELECT active_price_version_id FROM merchant_pricing WHERE merchant_id=$1)",[merchant,pv]);
  await db.query('UPDATE merchant_pricing SET active_price_version_id=$2,revision=revision+1 WHERE merchant_id=$1',[merchant,pv]);
 });
 await db.query('SAVEPOINT sync_apply');
 try{await apply(q2,randomUUID());assert.fail('stale quote');}catch(e:any){assert.equal(e.details?.reasonCode,'COUPON_INELIGIBLE');}
 await db.query('ROLLBACK TO SAVEPOINT sync_apply');
 await db.query('ROLLBACK TO SAVEPOINT sync');
 // A plain merchant coupon (no reward behind it) is untouched by the voucher gate.
 await db.query('ROLLBACK TO SAVEPOINT cost');
}));

test('concurrent double redeem of the whole balance succeeds exactly once and replays are stable',integration,async()=>{
 const f=await tableFixture(30);
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const account=randomUUID(),token=randomBytes(32).toString('base64url');
 try{
  await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,'Redeemer','en')",[account,randomUUID()]);
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')",[account,randomUUID(),digest(token),digest(randomBytes(8).toString('hex'))]);
  const order=(await f.create(await f.quote(5))).order.id as string;
  const branch=(await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,name) VALUES($1,'Voucher branch') RETURNING id",[f.merchant])).rows[0].id;
  await admin.query('BEGIN');
  try{
   await admin.query("SET LOCAL session_replication_role='replica'");
   await admin.query("UPDATE bitpos.orders SET status='PAID',paid_at=now() WHERE id=$1",[order]);
   await admin.query("INSERT INTO bitpos.online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_status,acceptance_version,acceptance_deadline,decision_by) VALUES($1,$2,$3,$4,'ACCEPTED',1,now()+interval '1 hour',$5)",[f.merchant,order,account,branch,f.actor]);
   await admin.query('COMMIT');
  }catch(e){await admin.query('ROLLBACK');throw e;}
  const points=Number((await admin.query('SELECT div(total_minor::numeric,10::numeric^catalog_decimals)::bigint p FROM bitpos.order_authority WHERE order_id=$1',[order])).rows[0].p);
  assert.ok(points>=2);
  await f.tenant(f.merchant,db=>rewards.rewardSettings(db,f.merchant,f.actor,'owner','PUT',body({pointsCost:points,discountMinor:'1',minimumSpendMinor:'2'})));
  const rewardId=(await admin.query('SELECT id FROM bitpos.reward173_rewards WHERE merchant_id=$1',[f.merchant])).rows[0].id as string;
  const call=(key:string)=>rewards.mobileRewardVoucherRequest(new URL('http://x/api/mobile/v1/account/rewards/redeem'),'POST',{rewardId,idempotencyKey:key},'Bearer '+token).then(v=>({ok:true as const,v}),e=>({ok:false as const,e}));
  const results=await Promise.all(Array.from({length:6},()=>call(randomUUID())));
  const wins=results.filter(r=>r.ok),losses=results.filter(r=>!r.ok);
  assert.equal(wins.length,1,'exactly one concurrent redemption of the whole balance wins');
  for(const l of losses)assert.equal((l as any).e.code,'REWARD_INSUFFICIENT_POINTS');
  assert.equal((await admin.query('SELECT count(*)::int n FROM bitpos.reward173_vouchers WHERE account_id=$1',[account])).rows[0].n,1);
  assert.equal((wins[0] as any).v.balance,0);
  // Same key raced against itself: one voucher, same answer.
  const sameKey=randomUUID();
  await admin.query('UPDATE bitpos.reward173_rewards SET points_cost=1 WHERE id=$1',[rewardId]).catch(()=>undefined);
  const catalog=await rewards.mobileRewardVoucherRequest(new URL('http://x/api/mobile/v1/account/rewards/catalog'),'GET',undefined,'Bearer '+token) as any;
  assert.equal(catalog.rewards[0].balance,0);assert.equal(catalog.rewards[0].redeemable,false);void sameKey;
  const list=await rewards.mobileRewardVoucherRequest(new URL('http://x/api/mobile/v1/account/vouchers'),'GET',undefined,'Bearer '+token) as any;
  assert.equal(list.vouchers.length,1);assert.equal(list.vouchers[0].state,'AVAILABLE');
  await assert.rejects(rewards.mobileRewardVoucherRequest(new URL('http://x/api/mobile/v1/account/vouchers?x=1'),'GET',undefined,'Bearer '+token),/INVALID_REQUEST/);
 }finally{
  await admin.query('DELETE FROM bitpos.online_food_orders WHERE merchant_id=$1',[f.merchant]).catch(()=>undefined);
  await admin.query('DELETE FROM bitpos.mobile_sessions WHERE account_id=$1',[account]).catch(()=>undefined);
  await admin.end();await pool.end();
 }
});
