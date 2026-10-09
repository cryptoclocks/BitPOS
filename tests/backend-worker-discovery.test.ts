import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

test('worker finds only actionable merchant IDs despite ordinary cross-tenant RLS, without exposing payment rows',{skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1',timeout:30000},async()=>{
 const {config}=await import('../apps/api/src/config');
 const db=new pg.Client({connectionString:config.DATABASE_URL});await db.connect();
 const cases=[
  {order:null,expired:false,attempt:null,signed:false,pending:false},
  ...['AWAITING_WALLET','AWAITING_PAYMENT','CONFIRMING'].map(order=>({order,expired:true,attempt:null,signed:false,pending:true})),
  ...['READY','SUBMITTING','SUBMITTED','CONFIRMED'].map(attempt=>({order:'AWAITING_PAYMENT',expired:false,attempt,signed:attempt!=='READY',pending:true})),
  {order:'EXPIRED',expired:true,attempt:'EXPIRED',signed:true,pending:true},
  {order:'EXPIRED',expired:true,attempt:'EXPIRED',signed:true,reconciled:true,pending:false},
  {order:'EXPIRED',expired:true,attempt:'EXPIRED',signed:false,pending:false},
  {order:'PAID',expired:true,attempt:'FINALIZED',signed:true,pending:false},
  {order:'AWAITING_WALLET',expired:false,attempt:'BUILDING',signed:false,pending:false},
  {order:'AWAITING_PAYMENT',expired:true,attempt:'READY',signed:false,pending:true}
 ];
 const ids=cases.map(()=>randomUUID());
 try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  for(const [index,merchant] of ids.entries()){
   const fixture=cases[index];
   await db.query("INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,'Rollback worker-discovery fixture','11111111111111111111111111111111')",[merchant]);
   if(!fixture.order)continue;
   await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
   const customer=(await db.query('INSERT INTO bitpos.customers(merchant_id) VALUES($1) RETURNING id',[merchant])).rows[0].id;
   const order=(await db.query("INSERT INTO bitpos.orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at,status) VALUES($1,$2,100,1,'11111111111111111111111111111111','rollback-fixture',$3,$4,'rollback-worker-discovery',clock_timestamp()+CASE WHEN $5::boolean THEN interval '-1 day' ELSE interval '1 day' END,$6) RETURNING id",[merchant,customer,randomUUID(),randomUUID(),fixture.expired,fixture.order])).rows[0].id;
   if(fixture.attempt)await db.query("INSERT INTO bitpos.payment_attempts(merchant_id,order_id,reference,payer,recipient,amount_minor,mint,token_program,status,signature,failure_reconciled_at) VALUES($1,$2,$3,'unsigned-rollback-payer','unsigned-rollback-recipient',1,'rollback-mint','rollback-program',$4,$5,CASE WHEN $6::boolean THEN clock_timestamp() END)",[merchant,order,randomUUID(),fixture.attempt,fixture.signed?'rollback-signed-'+randomUUID():null,'reconciled' in fixture&&fixture.reconciled===true]);
  }
  await db.query("SELECT set_config('bitpos.merchant','',true)");
  assert.equal((await db.query('SELECT id FROM bitpos.orders WHERE merchant_id=ANY($1::uuid[])',[ids])).rowCount,0,'ordinary row visibility remains tenant restricted');
  const discovered=(await db.query('SELECT merchant_id FROM bitpos.reconciliation_merchants() WHERE merchant_id=ANY($1::uuid[]) ORDER BY merchant_id',[ids])).rows.map(row=>row.merchant_id);
  assert.deepEqual(discovered,ids.filter((_,index)=>cases[index].pending).sort(),'all expired/live/signed cases remain actionable once; idle/terminal/unsigned-expired history is absent');
  const prioritized=(await db.query('SELECT merchant_id,priority FROM bitpos.reconciliation_queue() WHERE merchant_id=ANY($1::uuid[]) ORDER BY priority,merchant_id',[ids])).rows;
  assert.deepEqual(prioritized.filter(row=>row.priority===0).map(row=>row.merchant_id).sort(),ids.filter((_,index)=>cases[index].signed&&['SUBMITTING','SUBMITTED','CONFIRMED'].includes(cases[index].attempt??'')).sort(),'signed live payments are prioritized even without cross-tenant row visibility');
  assert.equal((await db.query("SELECT has_function_privilege('anon','bitpos.reconciliation_queue()','EXECUTE') AS allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege('anon','bitpos.reconciliation_merchants()','EXECUTE') AS allowed")).rows[0].allowed,false,'anonymous users cannot discover reconciliation work');
 }finally{await db.query('ROLLBACK');await db.end();}
});
