import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// M13: the shop-readiness check over the real HTTP server and SQL. It must follow the shop's real data: archive the only product, revoke the paired
// device or retire the register and the matching item flips back to "todo".
// Needs BITPOS_BACKEND_INTEGRATION=1 plus a throwaway Postgres with migrations through 191.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});

test('readiness: required items follow the shop’s real data, recommended items are separate, roles and tenants are fenced',integration,async()=>{
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const ids={owner:randomUUID(),staff:randomUUID()};
 const tok={owner:await staffToken(f.pool,f.merchant,ids.owner,'owner'),manager:await staffToken(f.pool,f.merchant,randomUUID(),'manager'),staff:await staffToken(f.pool,f.merchant,ids.staff,'staff'),other:await staffToken(f.pool,f.other,randomUUID(),'owner')};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:1});
 const sql=(q:string,a:unknown[]=[])=>admin.query(q,a);
 const get=async(who:keyof typeof tok|null)=>{const r=await fetch(base+'/api/help/readiness',{headers:who?{Authorization:`Bearer ${tok[who]}`}:{}});return {status:r.status,body:await r.json() as any};};
 const done=(b:any)=>Object.fromEntries(b.items.map((i:any)=>[i.id,i.done]));
 try{
  assert.equal((await get(null)).status,401);assert.equal((await get('staff')).status,403);
  // a configured shop: required items done; hours, receipt layout and staff PINs are only recommendations
  const a=(await get('owner')).body;
  assert.deepEqual(a.items.map((i:any)=>[i.id,i.level]),[['wallet','required'],['products','required'],['prices','required'],['register','required'],['register_paired','required'],['hours','recommended'],['receipt','recommended'],['team_pins','recommended']]);
  assert.deepEqual(done(a),{wallet:true,products:true,prices:true,register:true,register_paired:true,hours:false,receipt:false,team_pins:false});
  assert.deepEqual([a.ready,a.lowStock],[true,0]);assert.equal((await get('manager')).body.ready,true);
  assert.deepEqual(a.items.find((i:any)=>i.id==='team_pins').detail,{count:0,of:1},'one staff account, no PIN yet');
  // another shop with nothing set up is not ready and does not see this shop’s data
  const o=(await get('other')).body;assert.equal(o.ready,false);assert.deepEqual([done(o).products,done(o).prices,done(o).register,done(o).register_paired],[false,false,false,false]);

  // recommended items follow their data
  await sql("INSERT INTO merchant_opening_hours(merchant_id,time_zone,week) VALUES($1,'Asia/Bangkok','{}'::jsonb)",[f.merchant]);
  const put=await fetch(base+'/api/receipt-settings',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${tok.owner}`},body:JSON.stringify({shopName:'x',shopNameEn:'',footer:'',footerEn:'',defaultLang:'th',paperMm:80,expectedRevision:0})});assert.equal(put.status,200);
  await sql("INSERT INTO staff_profiles(merchant_id,user_id,pin_hash,pin_set_at) VALUES($1,$2,'hash',now()) ON CONFLICT(merchant_id,user_id) DO UPDATE SET pin_hash='hash',pin_set_at=now()",[f.merchant,ids.staff]);
  const b=(await get('owner')).body;assert.deepEqual(done(b),{wallet:true,products:true,prices:true,register:true,register_paired:true,hours:true,receipt:true,team_pins:true});

  // required items flip back when the real thing goes away
  await sql('UPDATE products SET archived_at=now() WHERE id=$1',[f.product]);
  let c=(await get('owner')).body;assert.deepEqual([done(c).products,c.ready],[false,false]);
  await sql('UPDATE products SET archived_at=NULL WHERE id=$1',[f.product]);
  await sql('UPDATE devices SET revoked_at=now() WHERE merchant_id=$1 AND id=$2',[f.merchant,f.a.id]);
  c=(await get('owner')).body;assert.deepEqual([done(c).register,done(c).register_paired,c.ready],[true,false,false],'a register whose screen was revoked is not paired');
  await sql('UPDATE devices SET revoked_at=NULL WHERE merchant_id=$1 AND id=$2',[f.merchant,f.a.id]);
  await sql('UPDATE registers SET retired_at=now() WHERE merchant_id=$1',[f.merchant]);
  c=(await get('owner')).body;assert.deepEqual([done(c).register,done(c).register_paired],[false,false]);
  await sql('UPDATE registers SET retired_at=NULL WHERE merchant_id=$1',[f.merchant]);
  await sql("UPDATE merchants SET treasury='' WHERE id=$1",[f.merchant]);
  assert.deepEqual([done((await get('owner')).body).wallet,(await get('owner')).body.ready],[false,false]);
  await sql("UPDATE merchants SET treasury='11111111111111111111111111111111' WHERE id=$1",[f.merchant]);

  // low stock counts only live products with a reorder level at or above the stock
  await sql('UPDATE products SET reorder_level=stock+1 WHERE id=$1',[f.product]);assert.equal((await get('owner')).body.lowStock,1);
  await sql('UPDATE products SET archived_at=now() WHERE id=$1',[f.product]);assert.equal((await get('owner')).body.lowStock,0);
  await sql('UPDATE products SET archived_at=NULL,reorder_level=NULL WHERE id=$1',[f.product]);assert.equal((await get('owner')).body.lowStock,0);
 }finally{
  server.close();
  for(const t of ['receipt_settings','merchant_opening_hours','staff_profiles'])await sql(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]).catch(()=>undefined);
  await admin.end();
 }
});
