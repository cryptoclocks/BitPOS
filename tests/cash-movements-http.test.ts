import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import test from 'node:test';
import pg from 'pg';
// M06 over the real HTTP server + real SQL: cash in/out with reasons, the expected-cash formula, close with a server-computed variance, close vs sale race.
// Needs a throwaway Postgres with migrations through 189 (CHANNEL_TEST_DB).
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:url??'postgres://x',ADMIN_DATABASE_URL:url??'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {hash}=await import('../packages/domain/src/index');
const M=randomUUID(),M2=randomUUID(),P1=randomUUID();
const U={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),other:randomUUID()};
const TOKEN=Object.fromEntries(Object.keys(U).map(r=>[r,`tok-${r}-${randomUUID()}`])) as Record<keyof typeof U,string>;

test('cash movements, expected cash, close variance and the close/sale race',integration,async()=>{
 const {server}=await import('../apps/api/src/index');const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query('SET search_path=bitpos,public');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const call=async(role:keyof typeof U|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:`Bearer ${TOKEN[role]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 const mv=(role:keyof typeof U|null,kind:string,amount:string,reason='ซื้อน้ำแข็ง',key=randomUUID())=>call(role,'POST','/api/cash/movements',{idempotencyKey:key,kind,amountMinor:amount,reason});
 const drawer=async()=>(await call('staff','GET','/api/cash/drawer')).body;
 try{
  await admin.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Move shop',$2),($3,'Other',$2)",[M,'1'.repeat(32),M2]);
  await admin.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'ลาเต้','Latte','x',100,50)",[M,P1]);
  for(const r of ['owner','manager','staff'] as const){await admin.query('INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,$3)',[U[r],M,r]);await admin.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[hash(TOKEN[r]),U[r],M,r]);}
  await admin.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[U.other,M2]);await admin.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,'owner',now()+interval '1 hour')",[hash(TOKEN.other),U.other,M2]);
  assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'ร้าน',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'M',staffMaxDiscountBps:0})).status,200);
  assert.equal((await call('manager','PUT','/api/cash/prices',{set:[{productId:P1,priceMinor:'6500'}]})).status,200);

  // not before the drawer is open; anonymous refused
  assert.equal((await mv(null,'IN','1000')).status,401);
  const early=await mv('staff','IN','1000');assert.deepEqual([early.status,early.body.error?.code],[409,'DRAWER_NOT_OPEN']);
  assert.equal((await call('staff','PUT','/api/cash/drawer',{floatMinor:'100000'})).body.expectedMinor,'100000');

  // roles, strict bodies, reason length
  assert.equal((await mv('staff','OUT','2000')).status,403);                         // cash out needs owner/manager
  for(const bad of [{kind:'IN',amountMinor:'0'},{kind:'IN',amountMinor:'-5'},{kind:'IN',amountMinor:'12.5'},{kind:'SWAP',amountMinor:'100'}]) assert.equal((await call('manager','POST','/api/cash/movements',{idempotencyKey:randomUUID(),reason:'ทดสอบ',...bad})).status,422);
  assert.equal((await mv('manager','IN','1000','ab')).status,422);assert.equal((await mv('manager','IN','1000','x'.repeat(121))).status,422);
  assert.equal((await call('manager','POST','/api/cash/movements',{idempotencyKey:randomUUID(),kind:'IN',amountMinor:'1000',reason:'ทดสอบ',extra:1})).status,422);
  assert.equal((await call('manager','POST','/api/cash/movements',{idempotencyKey:'short',kind:'IN',amountMinor:'1000',reason:'ทดสอบ'})).status,422);

  // in/out change expected cash: 100000 + sale 6500 + in 5000 - out 20000 = 91500
  const sale=await call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:P1,qty:1}],tenderMinor:'10000'});assert.equal(sale.status,200);
  const inKey=randomUUID();const cashIn=await mv('staff','IN','5000','เติมเงินทอน',inKey);assert.deepEqual([cashIn.status,cashIn.body.replayed,cashIn.body.movement.kind,cashIn.body.movement.amountMinor],[200,false,'IN','5000']);
  const outKey=randomUUID();const cashOut=await mv('manager','OUT','20000','นำฝากธนาคาร',outKey);assert.equal(cashOut.status,200);
  let d=await drawer();assert.deepEqual([d.cashSalesMinor,d.cashInMinor,d.cashOutMinor,d.expectedMinor],['6500','5000','20000','91500']);
  // replay: same key + same body is the same movement, nothing doubled; a different body under the key is a conflict
  const replay=await mv('staff','IN','5000','เติมเงินทอน',inKey);assert.deepEqual([replay.status,replay.body.replayed,replay.body.movement.id],[200,true,cashIn.body.movement.id]);
  assert.equal((await mv('staff','IN','5001','เติมเงินทอน',inKey)).status,409);
  assert.equal((await drawer()).cashInMinor,'5000');
  // a void lowers expected cash; cash out can never exceed what the drawer should hold
  const over=await mv('manager','OUT','91501');assert.deepEqual([over.status,over.body.error?.code],[409,'INSUFFICIENT_CASH']);
  assert.equal((await call('manager','POST',`/api/cash/sales/${sale.body.sale.id}/void`,{reason:'คิดเงินผิด',restock:true})).status,200);
  d=await drawer();assert.deepEqual([d.cashSalesMinor,d.expectedMinor],['0','85000']);
  assert.equal((await mv('manager','OUT','85001')).body.error?.code,'INSUFFICIENT_CASH');
  // two cash-outs racing for the same money: exactly one wins
  const race=await Promise.all([1,2,3].map(()=>mv('manager','OUT','50000','แข่งกัน '+randomUUID().slice(0,4))));
  assert.equal(race.filter(r=>r.status===200).length,1);assert.equal(race.filter(r=>r.status===409&&r.body.error?.code==='INSUFFICIENT_CASH').length,2);
  assert.equal((await drawer()).expectedMinor,'35000');
  // list: current round, newest first, with reasons and actors; tenant fence
  const list=(await call('staff','GET','/api/cash/movements')).body.movements;assert.equal(list.length,3);assert.ok(list.every((m:any)=>m.reason.length>=3&&m.createdBy));assert.equal(list[list.length-1].reason,'เติมเงินทอน');
  assert.equal((await call('other','GET','/api/cash/movements')).body.movements.length,0);
  assert.equal((await call('staff','GET','/api/cash/movements?x=1')).status,422);
  // immutable: not even the superuser can edit/delete (trigger); the app role has no right to
  await assert.rejects(()=>admin.query("UPDATE cash_movements SET reason='แก้ไข' WHERE merchant_id=$1",[M]),/immutable|not allowed|cannot/i);
  await assert.rejects(()=>admin.query('DELETE FROM cash_movements WHERE merchant_id=$1',[M]),/immutable|not allowed|cannot/i);

  // close round 1 with a count in ANOTHER currency: nothing is compared (no variance), the round is frozen with its figures
  const r1=await call('manager','POST','/api/shifts/close',{idempotencyKey:randomUUID()+'-r1',note:'',countedCash:{minor:'1',currency:'USD',decimals:2}});assert.equal(r1.status,200);
  const f1=r1.body.close.snapshot.drawer;assert.deepEqual([f1.openingFloatMinor,f1.cashSalesMinor,f1.cashInMinor,f1.cashOutMinor,f1.expectedMinor,f1.countedMinor,f1.varianceMinor],['100000','0','5000','70000','35000',null,null]);
  // round 1's movements stay readable by its start; the new round starts empty and needs its own float before any cash moves
  const old=(await call('staff','GET','/api/cash/movements?periodStart='+encodeURIComponent(r1.body.close.periodStart))).body;assert.equal(old.movements.length,3);
  assert.equal((await call('staff','GET','/api/cash/movements')).body.movements.length,0);
  assert.equal((await mv('manager','IN','1000')).body.error?.code,'DRAWER_NOT_OPEN');
  // round 2: float 10000, cash in 2000, count 11000: expected 12000, variance -1000 worked out by the server
  assert.equal((await call('staff','PUT','/api/cash/drawer',{floatMinor:'10000'})).status,200);assert.equal((await mv('staff','IN','2000','เติมเงินทอน')).status,200);
  const r2=await call('manager','POST','/api/shifts/close',{idempotencyKey:randomUUID()+'-r2',note:'นับแล้ว',countedCash:{minor:'11000',currency:'THB',decimals:2}});
  const f2=r2.body.close.snapshot.drawer;assert.deepEqual([f2.expectedMinor,f2.countedMinor,f2.varianceMinor],['12000','11000','-1000']);
  const history=(await call('manager','GET','/api/shifts')).body.closes;assert.equal(history[0].snapshot.drawer.varianceMinor,'-1000');assert.equal(history[1].snapshot.drawer.varianceMinor,null);
  // close vs sale race: sales and a close fired together; every sale is in exactly one round and the frozen total equals the sales made before the close
  assert.equal((await call('staff','PUT','/api/cash/drawer',{floatMinor:'0'})).status,200);
  const results=await Promise.all([...Array(6)].map(()=>call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:P1,qty:1}],tenderMinor:'6500'})).concat([call('manager','POST','/api/shifts/close',{idempotencyKey:randomUUID()+'-r3',note:'',countedCash:null})] as any));
  const close3=results[6]!;assert.equal(close3.status,200);assert.ok(results.slice(0,6).every(r=>r.status===200));
  const snap=close3.body.close.snapshot,end=close3.body.close.periodEnd,start3=close3.body.close.periodStart;
  const inRound=(await admin.query("SELECT count(*)::int n,COALESCE(sum(total_minor),0)::text t FROM cash_sales WHERE merchant_id=$1 AND status='PAID' AND created_at>=$2 AND created_at<$3",[M,start3,end])).rows[0];
  const frozen=snap.groups.find((g:any)=>g.sourceKind==='cash_counter');assert.deepEqual([frozen?.orders??0,frozen?.totalMinor??'0'],[inRound.n,inRound.t]);
  assert.equal(snap.drawer.cashSalesMinor,inRound.t);assert.equal(snap.drawer.expectedMinor,inRound.t);
  const later=(await admin.query("SELECT count(*)::int n FROM cash_sales WHERE merchant_id=$1 AND created_at>=$2",[M,end])).rows[0].n;assert.equal(inRound.n+later,6,'no sale lost or counted twice');
  // audit
  const log=(await admin.query("SELECT action FROM audit_logs WHERE merchant_id=$1",[M])).rows.map(r=>r.action);for(const a of ['cash.movement.in','cash.movement.out','shift.close'])assert.ok(log.includes(a),a);
 }catch(e){throw e}finally{
  await admin.query('BEGIN');await admin.query('SET LOCAL session_replication_role=replica');
  for(const m of [M,M2])for(const t of ['cash_movements','cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_drawer_openings','cash_settings','shift_closes'])await admin.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[m]).catch(()=>undefined);
  for(const m of [M,M2]){await admin.query("DELETE FROM stock_movements WHERE merchant_id=$1",[m]).catch(()=>undefined);for(const t of ['audit_logs','sessions','members','products'])await admin.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[m]).catch(()=>undefined);await admin.query('DELETE FROM merchants WHERE id=$1',[m]).catch(()=>undefined);}
  await admin.query('COMMIT');await admin.end();server.close();await pool.end();
 }
});
