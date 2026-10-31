import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
test('rewards are derived points: paid online orders only, per currency, refunds excluded, own account and live session only',integration,async()=>{
 const f=await tableFixture(30);
 // Loading boundary: skipped integration never loads private runtime config.
 const {mobileProfileRequest}=await import('../apps/api/src/mobile-profile');
 const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const account=randomUUID(),other=randomUUID(),token=randomBytes(32).toString('base64url'),otherToken=randomBytes(32).toString('base64url'),expired=randomBytes(32).toString('base64url');
 const accounts=[account,other];
 try{
  for(const [id,t] of [[account,token],[other,otherToken]] as const){
   await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,'Rewards','en')",[id,randomUUID()]);
   await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 day')",[id,randomUUID(),digest(t),digest(randomBytes(8).toString('hex'))]);
  }
  await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()-interval '1 hour',now()+interval '1 day')",[account,randomUUID(),digest(expired),digest(randomBytes(8).toString('hex'))]);
  // Endpoint over committed data: a fresh account has earned nothing.
  const url=new URL('http://localhost/api/mobile/v1/account/rewards');
  assert.deepEqual((await mobileProfileRequest(url,'GET',undefined,'Bearer '+token) as any).totals,[]);
  // The aggregate itself, in one rolled-back transaction with lifecycle triggers disabled (test setup only):
  // four real counter orders are re-labelled as this account's online orders.
  let generation=1;
  const order=async(first=false,qty=1)=>{
   if(!first){const device=await f.reg('/api/devices','POST',{label:'R'+generation});generation++;await f.reg('/api/devices/'+device.id+'/credential','POST',{});await f.tenant(f.merchant,db=>db.query("UPDATE device_presence SET connection_generation=1,connection_id=gen_random_uuid(),connected_until=clock_timestamp()+interval '1 hour' WHERE device_id=$1",[device.id]));await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:device.id,expectedPairingGeneration:String(generation)});}
   return (await f.create(await f.quote(qty))).order.id as string;
  };
  const paid1=await order(true,5),paid2=await order(false,3),unpaid=await order(false,4),refunded=await order(false,2);
  const unit=async(id:string)=>{const r=(await admin.query('SELECT catalog_currency AS c,catalog_decimals AS d,total_minor AS t FROM bitpos.order_authority WHERE order_id=$1',[id])).rows[0];return {c:r.c as string,points:Number(BigInt(r.t)/10n**BigInt(r.d))};};
  const [u1,u2,ur]=[await unit(paid1),await unit(paid2),await unit(refunded)];
  assert.equal(u1.c,u2.c);
  const sessionId=(await admin.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[account,digest(token)])).rows[0].id;
  const totals=async(acct:string,sess:string)=>(await admin.query('SELECT currency,decimals,orders,points::text FROM bitpos.mobile_reward_totals($1,$2)',[acct,sess])).rows;
  await admin.query('BEGIN');
  try{
   await admin.query("SET LOCAL session_replication_role='replica'");
   const branch=(await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,name) VALUES($1,'Rewards branch') RETURNING id",[f.merchant])).rows[0].id;
   for(const [id,status] of [[paid1,'PAID'],[paid2,'PAID'],[unpaid,'AWAITING_PAYMENT'],[refunded,'PAID']]){
    await admin.query("UPDATE bitpos.orders SET status=$2,paid_at=CASE WHEN $2='PAID' THEN now() ELSE NULL END WHERE id=$1",[id,status]);
    await admin.query("INSERT INTO bitpos.online_food_orders(merchant_id,order_id,account_id,branch_id,acceptance_status,acceptance_version,acceptance_deadline,decision_by) VALUES($1,$2,$3,$4,'ACCEPTED',1,now()+interval '1 hour',$5)",[f.merchant,id,account,branch,f.actor]);
   }
   const before=await totals(account,sessionId);
   assert.deepEqual(before.map((r:any)=>[r.currency,Number(r.orders),Number(r.points)]),[[u1.c,3,u1.points+u2.points+ur.points]],'unpaid is excluded; the refund-free paid orders count');
   await admin.query("INSERT INTO bitpos.refunds(merchant_id,order_id,payment_id,status,amount_minor,asset_descriptor,settlement,beneficiary,cause) VALUES($1,$2,$3,'REQUESTED',1,'{}'::jsonb,'{}'::jsonb,'test','LEGACY_REQUESTED')",[f.merchant,refunded,randomUUID()]);
   const after=await totals(account,sessionId);
   assert.deepEqual(after.map((r:any)=>[r.currency,Number(r.orders),Number(r.points)]),[[u1.c,2,u1.points+u2.points]],'a refund obligation removes that order from the points');
   const otherSession=(await admin.query("INSERT INTO bitpos.mobile_sessions(account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour',now()+interval '1 day') RETURNING id",[other,randomUUID(),digest('x1'),digest('x2')])).rows[0].id;
   assert.deepEqual(await totals(other,otherSession),[],'another account earns nothing from these orders');
   assert.deepEqual(await totals(account,otherSession),[],'a session of a different account cannot read this account');
  }finally{await admin.query('ROLLBACK');}
  await assert.rejects(mobileProfileRequest(url,'GET',undefined,'Bearer '+expired),/AUTH_REQUIRED/,'an expired session reads nothing');
  await assert.rejects(mobileProfileRequest(url,'GET',undefined,undefined),/AUTH_REQUIRED/);
  await assert.rejects(mobileProfileRequest(new URL(url.href+'?x=1'),'GET',undefined,'Bearer '+token),/INVALID_REQUEST/);
  await assert.rejects(mobileProfileRequest(url,'POST',{},'Bearer '+token),/INVALID_REQUEST/);
  const commands=async()=>(await admin.query('SELECT count(*)::int AS n FROM bitpos.mobile_account_commands')).rows[0].n;
  const before=await commands();await mobileProfileRequest(url,'GET',undefined,'Bearer '+token);assert.equal(await commands(),before,'reading writes nothing');
 }finally{
  await admin.query('DELETE FROM bitpos.online_food_orders WHERE merchant_id=$1',[f.merchant]).catch(()=>undefined);
  for(const id of accounts){await admin.query('DELETE FROM bitpos.mobile_sessions WHERE account_id=$1',[id]).catch(()=>undefined);}
  await admin.end();await pool.end();
 }
});
