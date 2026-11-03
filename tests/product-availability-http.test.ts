import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import test from 'node:test';
import pg from 'pg';
// Real HTTP server + real roles + real SQL: who may pause/resume/set hours, revision conflicts, the menu flag, the cash register refusal, audit rows, tenant fences.
// Needs a throwaway Postgres with migrations through 186 (CHANNEL_TEST_DB).
const url=process.env.CHANNEL_TEST_DB,integration={skip:!url};
Object.assign(process.env,{DATABASE_URL:url??'postgres://x',ADMIN_DATABASE_URL:url??'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {hash}=await import('../packages/domain/src/index');
const M=randomUUID(),M2=randomUUID(),P1=randomUUID(),P2=randomUUID(),FOREIGN=randomUUID();
const USERS={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),other:randomUUID()};
const TOKEN=Object.fromEntries(Object.keys(USERS).map(r=>[r,`tok-${r}-${randomUUID()}`])) as Record<keyof typeof USERS,string>;

test('pause / resume / selling window over HTTP with role, revision, menu, cash register and audit',integration,async()=>{
 const {server}=await import('../apps/api/src/index');const {pool}=await import('../apps/api/src/db');
 const admin=new pg.Client({connectionString:url});await admin.connect();await admin.query('SET search_path=bitpos,public');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const call=async(role:keyof typeof USERS|null,method:string,path:string,body?:unknown)=>{
  const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(role?{Authorization:`Bearer ${TOKEN[role]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,body:await res.json() as any};
 };
 const avail=async(id:string)=>(await call('staff','GET','/api/products/availability')).body.availability.find((a:any)=>a.productId===id);
 const hhmmNow=(plusMin:number)=>{const d=new Date(Date.now()+plusMin*60000+7*3600000);return d.toISOString().slice(11,16);}; // Asia/Bangkok default zone
 try{
  await admin.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'Avail shop',$2),($3,'Other shop',$2)",[M,'1'.repeat(32),M2]);
  for(const p of [P1,P2])await admin.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'ลาเต้','Latte','x',100,20)",[M,p]);
  await admin.query("INSERT INTO products(merchant_id,id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'อื่น','Foreign','x',100,5)",[M2,FOREIGN]);
  for(const r of ['owner','manager','staff'] as const){
   await admin.query('INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,$3)',[USERS[r],M,r]);
   await admin.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 hour')",[hash(TOKEN[r]),USERS[r],M,r]);
  }
  await admin.query('INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,$3)',[USERS.other,M2,'owner']);
  await admin.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,'owner',now()+interval '1 hour')",[hash(TOKEN.other),USERS.other,M2]);
  await admin.query("INSERT INTO cash_settings(merchant_id,enabled,currency,decimals,vat_mode,vat_bps,seller_name,seller_tax_id,seller_branch,seller_address,receipt_prefix,staff_max_discount_bps,updated_by) VALUES($1,true,'THB',2,'none',700,'','','00000','','A',0,$2)",[M,USERS.owner]);
  await admin.query("INSERT INTO cash_prices(merchant_id,product_id,price_minor,updated_by) VALUES($1,$2,6500,$3)",[M,P1,USERS.owner]);

  // reads need a session; everyone starts available all day
  assert.equal((await call(null,'GET','/api/products/availability')).status,401);
  const a0=await avail(P1);assert.deepEqual([a0.paused,a0.unavailable,a0.sellFrom,a0.revision],[false,null,null,'1']);
  const sale=(qty=1)=>call('staff','POST','/api/cash/quote',{items:[{productId:P1,qty}]});
  assert.equal((await sale()).status,200);

  // strict bodies, unknown product, other shop's product
  assert.equal((await call('staff','PUT',`/api/products/${P1}/availability`,{expectedRevision:'1'})).status,422);
  assert.equal((await call('staff','PUT',`/api/products/${P1}/availability`,{expectedRevision:'1',pause:{until:null,reason:'',extra:1}})).status,422);
  assert.equal((await call('staff','PUT',`/api/products/${P1}/availability`,{expectedRevision:'1',pause:{until:new Date(Date.now()-1000).toISOString(),reason:'x'}})).status,422);
  assert.equal((await call('owner','PUT',`/api/products/${randomUUID()}/availability`,{expectedRevision:'1',pause:null})).status,404);
  assert.equal((await call('owner','PUT',`/api/products/${FOREIGN}/availability`,{expectedRevision:'1',pause:{until:null,reason:'x'}})).status,404);
  assert.equal((await call('other','PUT',`/api/products/${P1}/availability`,{expectedRevision:'1',pause:{until:null,reason:'x'}})).status,404);

  // staff may pause (operating action) with a reason; the revision moves; the cash register refuses it; the menu shows it unavailable
  const paused=await call('staff','PUT',`/api/products/${P1}/availability`,{expectedRevision:'1',pause:{until:null,reason:'นมหมด'}});
  assert.deepEqual([paused.status,paused.body.paused,paused.body.unavailable,paused.body.revision,paused.body.pausedReason],[200,true,'PAUSED','2','นมหมด']);
  const refused=await sale();assert.deepEqual([refused.status,refused.body.error?.code],[409,'PRODUCT_PAUSED']);
  assert.equal((await call('staff','POST','/api/cash/quote',{items:[{productId:P2,qty:1}]})).status,422); // P2 has no cash price: unrelated to the pause
  const menu=(await call('staff','GET','/api/menu')).body;const mp=menu.products.find((p:any)=>p.id===P1);assert.deepEqual([mp.available,mp.unavailable],[0,'PAUSED']);assert.equal(menu.products.find((p:any)=>p.id===P2).unavailable,undefined);
  assert.equal(menu.products.find((p:any)=>p.id===P2).available,20);
  // stale revision is a conflict, nothing changes
  assert.equal((await call('manager','PUT',`/api/products/${P1}/availability`,{expectedRevision:'1',pause:null})).status,409);
  assert.equal((await avail(P1)).paused,true);
  // stock and reservations are untouched by a pause
  const st=(await admin.query('SELECT stock,reserved FROM products WHERE id=$1',[P1])).rows[0];assert.deepEqual([st.stock,st.reserved],[20,0]);

  // a timed pause ends by itself: set until in the future, then move the clock by rewriting the stored end (the function compares to now())
  assert.equal((await call('manager','PUT',`/api/products/${P1}/availability`,{expectedRevision:'2',pause:{until:new Date(Date.now()+3600000).toISOString(),reason:'พัก 1 ชม.'}})).status,200);
  assert.equal((await avail(P1)).unavailable,'PAUSED');
  await admin.query("UPDATE products SET paused_at=now()-interval '2 hours',paused_until=now()-interval '1 second' WHERE id=$1",[P1]);
  assert.equal((await avail(P1)).unavailable,null);assert.equal((await avail(P1)).paused,false);assert.equal((await sale()).status,200);

  // resume clears the pause; selling window needs owner/manager
  assert.equal((await call('staff','PUT',`/api/products/${P1}/availability`,{expectedRevision:'3',window:{from:'07:00',to:'11:00'}})).status,403);
  assert.equal((await call('owner','PUT',`/api/products/${P1}/availability`,{expectedRevision:'3',window:{from:'07:00',to:'07:00'}})).status,422);
  assert.equal((await call('owner','PUT',`/api/products/${P1}/availability`,{expectedRevision:'3',window:{from:'7:00',to:'11:00'}})).status,422);
  const past=await call('manager','PUT',`/api/products/${P1}/availability`,{expectedRevision:'3',pause:null,window:{from:hhmmNow(120),to:hhmmNow(180)}});
  assert.deepEqual([past.status,past.body.unavailable],[200,'OUTSIDE_HOURS']);
  assert.deepEqual((await sale()).body.error?.code,'OUTSIDE_SELLING_HOURS');
  assert.equal((await call('manager','GET','/api/menu')).body.products.find((p:any)=>p.id===P1).unavailable,'OUTSIDE_HOURS');
  const open=await call('owner','PUT',`/api/products/${P1}/availability`,{expectedRevision:past.body.revision,window:{from:hhmmNow(-60),to:hhmmNow(60)}});
  assert.deepEqual([open.status,open.body.unavailable,open.body.sellFrom!==null],[200,null,true]);assert.equal((await sale()).status,200);
  const cleared=await call('owner','PUT',`/api/products/${P1}/availability`,{expectedRevision:open.body.revision,window:null});assert.deepEqual([cleared.body.sellFrom,cleared.body.sellTo],[null,null]);

  // concurrent writers: exactly one wins per revision
  const rev=cleared.body.revision;
  const race=await Promise.all([1,2,3,4].map(i=>call(i%2?'staff':'manager','PUT',`/api/products/${P1}/availability`,{expectedRevision:rev,pause:{until:null,reason:'race '+i}})));
  assert.equal(race.filter(r=>r.status===200).length,1);assert.equal(race.filter(r=>r.status===409).length,3);
  // the other shop never saw any of it
  assert.equal((await call('other','GET','/api/products/availability')).body.availability.length,1);
  assert.equal((await call('other','GET','/api/menu')).body.products[0].unavailable,undefined);
  // audit trail with the actor
  const log=(await admin.query("SELECT action,actor FROM audit_logs WHERE merchant_id=$1 AND action LIKE 'catalog.product.%' ORDER BY id",[M])).rows;
  assert.ok(log.some(l=>l.action==='catalog.product.pause'&&l.actor===USERS.staff));assert.ok(log.some(l=>l.action==='catalog.product.window'&&l.actor===USERS.owner));
 }finally{
  for(const m of [M,M2]){for(const t of ['cash_sales','cash_prices','cash_settings','audit_logs','sessions','members','products'])await admin.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[m]).catch(()=>undefined);await admin.query('DELETE FROM merchants WHERE id=$1',[m]).catch(()=>undefined);}
  await admin.end();server.close();await pool.end();
 }
});
