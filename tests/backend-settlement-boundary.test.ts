import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const settlementSql='SELECT (r.updated_order).*,r.details AS settlement_details FROM bitpos.settle_verified_attempt($1::uuid,$2::uuid,$3::uuid,$4::boolean) AS r';
// SQL-only fixtures: no chain proof, wallet signing, durable rows, or worker-visible attempts.
test('settlement rejects missing proof stage and absent or foreign tenant without financial effects',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:30000},async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {config}=await import('../apps/api/src/config');
 const db=new pg.Client({connectionString:config.DATABASE_URL});await db.connect();
 const merchant=randomUUID();
 try {
  await assert.rejects(db.query(settlementSql,[merchant,randomUUID(),randomUUID(),true]),{code:'42501'},'a new connection has no caller tenant context');
  await db.query('BEGIN');
  await db.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'Rollback settlement-boundary fixture','11111111111111111111111111111111')",[merchant]);
  await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
  const customer=(await db.query('INSERT INTO bitpos.customers(merchant_id) VALUES($1) RETURNING id',[merchant])).rows[0].id;
  const order=(await db.query("INSERT INTO bitpos.orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at,status) VALUES($1,$2,100,1,'11111111111111111111111111111111','rollback-fixture',$3,$4,'rollback-settlement-boundary',clock_timestamp()+interval '1 day','AWAITING_PAYMENT') RETURNING id",[merchant,customer,randomUUID(),randomUUID()])).rows[0].id;
  const attempt=(await db.query("INSERT INTO bitpos.payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status,signature) VALUES($1,$2,$3,'rollback-payer','rollback-recipient',1,'rollback-mint','rollback-program','SUBMITTED',$4) RETURNING id",[merchant,order,randomUUID(),'not-a-chain-proof-'+randomUUID()])).rows[0].id;
  const otherOrder=(await db.query("INSERT INTO bitpos.orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at) VALUES($1,$2,100,1,'fixture-recipient','wrong-order-fixture',$3,$4,'wrong-order',clock_timestamp()+interval '1 day') RETURNING id",[merchant,customer,randomUUID(),randomUUID()])).rows[0].id;
  const foreign=randomUUID();
  await db.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'Foreign rollback fixture','fixture-recipient')",[foreign]);
  await db.query("SELECT set_config('bitpos.merchant',$1,true)",[foreign]);
  const foreignCustomer=(await db.query('INSERT INTO bitpos.customers(merchant_id) VALUES($1) RETURNING id',[foreign])).rows[0].id;
  const foreignOrder=(await db.query("INSERT INTO bitpos.orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at) VALUES($1,$2,100,1,'fixture-recipient','foreign-fixture',$3,$4,'foreign-order',clock_timestamp()+interval '1 day') RETURNING id",[foreign,foreignCustomer,randomUUID(),randomUUID()])).rows[0].id;
  const foreignAttempt=(await db.query("INSERT INTO bitpos.payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status,signature) VALUES($1,$2,$3,'p','r',1,'m','t','SUBMITTED',$4) RETURNING id",[foreign,foreignOrder,randomUUID(),randomUUID()])).rows[0].id;
  await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
  const snapshot=async()=>(await db.query('SELECT o.status,o.version,o.reservation_released,a.status AS attempt_status,(SELECT count(*)::int FROM bitpos.payments p WHERE p.order_id=o.id) AS payments FROM bitpos.orders o JOIN bitpos.payment_attempts a ON a.order_id=o.id WHERE o.id=$1',[order])).rows;
  const before=await snapshot();
  for(const boundary of [
   {tenant:merchant,stage:null,code:'22004',order,attempt},
   {tenant:'',stage:true,code:'42501',order,attempt},
   {tenant:randomUUID(),stage:true,code:'42501',order,attempt},
   {tenant:merchant,stage:true,code:'P0002',order:randomUUID(),attempt},
   {tenant:merchant,stage:true,code:'P0002',order:otherOrder,attempt},
   {tenant:merchant,stage:true,code:'P0002',order:foreignOrder,attempt:foreignAttempt},
   {tenant:merchant,stage:true,code:'P0002',order,attempt:randomUUID()}
  ]){
   await db.query('SAVEPOINT rejected_settlement');
   await db.query("SELECT set_config('bitpos.merchant',$1,true)",[boundary.tenant]);
   await assert.rejects(db.query(settlementSql,[merchant,boundary.order,boundary.attempt,boundary.stage]),{code:boundary.code});
   await db.query('ROLLBACK TO SAVEPOINT rejected_settlement');
   assert.deepEqual(await snapshot(),before,'no payment, attempt transition, order transition, or reservation release follows rejected input');
  }
  const confirmed=(await db.query(settlementSql,[merchant,order,attempt,false])).rows;
  assert.equal(confirmed.length,1);assert.equal(confirmed[0].status,'CONFIRMING');assert.equal(confirmed[0].version,2);
  assert.equal(confirmed[0].settlement_details,null,'legacy financial changes do not produce v2 facts');
  assert.equal((await db.query(settlementSql,[merchant,order,attempt,false])).rowCount,0);
  const paid=(await db.query(settlementSql,[merchant,order,attempt,true])).rows;
  assert.equal(paid.length,1);assert.equal(paid[0].status,'PAID');assert.equal(paid[0].version,3);
  assert.equal(paid[0].usdg_minor,'1');assert.ok(paid[0].paid_at instanceof Date);assert.ok(paid[0].quote_expires_at instanceof Date);
  assert.equal(paid[0].settlement_details,null);
  for(const stage of [false,true])assert.equal((await db.query(settlementSql,[merchant,order,attempt,stage])).rowCount,0);
  assert.equal((await db.query('SELECT status FROM bitpos.payment_attempts WHERE id=$1',[attempt])).rows[0].status,'FINALIZED');
  await db.query('SAVEPOINT missing_authority_fixture');
  const incomplete=(await db.query("INSERT INTO bitpos.orders(merchant_id,customer_id,authority_version,usdg_minor,treasury,idempotency_key,access_token,request_hash,quote_expires_at) VALUES($1,$2,2,1,'fixture-recipient',$3,$4,'incomplete-v2',clock_timestamp()+interval '1 day') RETURNING id",[merchant,customer,randomUUID(),randomUUID()])).rows[0].id;
  const incompleteAttempt=(await db.query("INSERT INTO bitpos.payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status,signature) VALUES($1,$2,$3,'p','r',1,'m','t','SUBMITTED',$4) RETURNING id",[merchant,incomplete,randomUUID(),randomUUID()])).rows[0].id;
  await db.query('SAVEPOINT missing_authority_call');
  await assert.rejects(db.query(settlementSql,[merchant,incomplete,incompleteAttempt,true]),{code:'23514',message:'MISSING_ORDER_AUTHORITY'});
  await db.query('ROLLBACK TO SAVEPOINT missing_authority_call');
  assert.equal((await db.query('SELECT status,version,paid_at FROM bitpos.orders WHERE id=$1',[incomplete])).rows[0].status,'AWAITING_WALLET');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM bitpos.payments WHERE order_id=$1',[incomplete])).rows[0].n,0);
  await db.query('ROLLBACK TO SAVEPOINT missing_authority_fixture');
 }finally{await db.query('ROLLBACK');await db.end();}
});

test('settlement facts are invoker-only and unavailable to browser roles',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'},async()=>{
 // Intentional loading boundary: skipped integration tests must not load private runtime config.
 const {config}=await import('../apps/api/src/config');
 const db=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
 try{
  const definition=(await db.query(`SELECT p.prosecdef,p.provolatile,p.proconfig,
   has_function_privilege('bitpos_app',p.oid,'EXECUTE') AS app,
   EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public
   FROM pg_proc p WHERE p.oid='bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean)'::regprocedure`)).rows[0];
  assert.equal(definition.prosecdef,false);assert.equal(definition.provolatile,'v');
  assert.deepEqual(definition.proconfig,['search_path=bitpos, pg_temp']);assert.equal(definition.app,true);assert.equal(definition.public,false);
  await db.query('BEGIN');
  for(const role of ['anon','authenticated','service_role']){
   assert.equal((await db.query("SELECT has_function_privilege($1,'bitpos.settle_verified_attempt(uuid,uuid,uuid,boolean)','EXECUTE') AS allowed",[role])).rows[0].allowed,false,role+' has no routine grant even if schema usage is denied');
   await db.query('SAVEPOINT denied_role');await db.query('SET LOCAL ROLE '+role);
   await assert.rejects(db.query(settlementSql,[randomUUID(),randomUUID(),randomUUID(),true]),{code:'42501'});
   await db.query('ROLLBACK TO SAVEPOINT denied_role');
  }
 }finally{await db.query('ROLLBACK');await db.end();}
});
