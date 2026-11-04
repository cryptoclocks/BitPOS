import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import pg from 'pg';
import {tableFixture,staffToken} from './backend-table-fixture';
// M09 over the real HTTP server and SQL: the audit viewer (server-side filters, paging, actor names, read-only for the app role, CSV that matches the
// screen), the shop-wide receipt settings (owner only, optimistic, race-safe) and the reprint record (copy numbers, only paid bills, audit).
// Needs BITPOS_BACKEND_INTEGRATION=1 plus a throwaway Postgres with migrations through 191.
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
after(async()=>{if(process.env.BITPOS_BACKEND_INTEGRATION==='1'){const {pool}=await import('../apps/api/src/db');await pool.end();}});

async function harness(){
 const f=await tableFixture();const {server}=await import('../apps/api/src/index');
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),other:randomUUID()};
 const tok={owner:await staffToken(f.pool,f.merchant,ids.owner,'owner'),manager:await staffToken(f.pool,f.merchant,ids.manager,'manager'),staff:await staffToken(f.pool,f.merchant,ids.staff,'staff'),other:await staffToken(f.pool,f.other,ids.other,'owner')};
 const call=async(who:keyof typeof tok|null,method:string,path:string,body?:unknown)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tok[who]}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();let parsed:any;try{parsed=JSON.parse(raw);}catch{parsed=raw;}return {status:r.status,body:parsed};};
 const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL,max:2});
 const cleanup=async()=>{server.close();const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET LOCAL session_replication_role=replica');
  for(const t of ['cash_sale_lines','cash_sales','cash_receipt_counters','cash_prices','cash_settings','receipt_settings'])await c.query(`DELETE FROM ${t} WHERE merchant_id=$1`,[f.merchant]).catch(()=>undefined);
  await c.query("DELETE FROM stock_movements WHERE merchant_id=$1 AND kind IN('CASH_SALE','CASH_VOID_RETURN')",[f.merchant]).catch(()=>undefined);await c.query('COMMIT');}catch{await c.query('ROLLBACK').catch(()=>undefined);}finally{c.release();await admin.end();}};
 return {f,call,ids,admin,cleanup};
}

test('audit viewer: server-side filters, shop-day boundaries, paging, actor names, strict query, roles; the app role cannot rewrite it; CSV equals the screen',integration,async()=>{
 const {f,call,ids,admin,cleanup}=await harness();
 try{
  await admin.query("INSERT INTO staff_profiles(merchant_id,user_id,display_name) VALUES($1,$2,'พี่ส้ม') ON CONFLICT(merchant_id,user_id) DO UPDATE SET display_name=excluded.display_name",[f.merchant,ids.staff]);
  const put=(actor:string,action:string,subject:string,at:string,merchant=f.merchant)=>admin.query('INSERT INTO audit_logs(merchant_id,actor,action,subject,created_at) VALUES($1,$2,$3,$4,$5::timestamptz)',[merchant,actor,action,subject,at]);
  // 60 stock events on 2026-03-05 (Bangkok), and the shop-day edge: 16:59:59.999Z is still 10 Mar in Bangkok, 17:00:00Z is 11 Mar
  for(let i=0;i<60;i++)await put(ids.manager,'inventory.receive','p'+i,`2026-03-05T03:${String(i).padStart(2,'0')}:00Z`);
  await put(ids.staff,'cash.sale','edge-before','2026-03-10T16:59:59.999Z');
  await put(ids.staff,'cash.void','=HYPERLINK("http://x")','2026-03-10T17:00:00Z');
  await put('acceptance-policy','refund.required','order-9','2026-03-12T01:00:00Z');
  await put(ids.owner,'receipt.settings','rev:1','2026-03-13T01:00:00Z');
  await put(randomUUID(),'inventory.adjust','ghost','2026-03-14T01:00:00Z'); // an actor who is no longer on the team
  await put(ids.other,'inventory.receive','foreign','2026-03-05T04:00:00Z',f.other);
  const get=(who:'owner'|'manager'|'staff'|'other'|null,q='')=>call(who,'GET','/api/activity'+q);

  // roles: owner and manager read, staff and anonymous do not, another shop sees only its own
  assert.equal((await get(null)).status,401);assert.equal((await get('staff')).status,403);
  assert.equal((await get('manager')).status,200);
  const foreign=await get('other');assert.deepEqual(foreign.body.entries.map((e:any)=>e.subject),['foreign']);

  // the newest entry first, with the name/role of the actor resolved from today's team and a plain system actor left as-is
  assert.equal((await get('owner')).body.entries[0].createdAt>'2026-04',true,'newest first: the fixture’s own recent entries lead');
  const top=(await get('owner','?from=2026-03-14&to=2026-03-14')).body;assert.equal(top.entries[0].action,'inventory.adjust');
  assert.deepEqual([top.entries[0].actorName,top.entries[0].actorRole],[null,null],'unknown account: no invented name');
  const sys=(await get('owner','?from=2026-03-12&to=2026-03-12')).body.entries;assert.deepEqual(sys.map((e:any)=>[e.actor,e.actorRole,e.actorName]),[['acceptance-policy',null,null]]);
  const cash=(await get('owner','?category=cash&from=2026-03-11&to=2026-03-11')).body.entries;assert.deepEqual(cash.map((e:any)=>[e.action,e.actorName,e.actorRole]),[['cash.void','พี่ส้ม','staff']]);

  // shop-day boundaries (Asia/Bangkok): 16:59:59.999Z belongs to 10 Mar, 17:00:00Z to 11 Mar
  assert.deepEqual((await get('owner','?from=2026-03-10&to=2026-03-10')).body.entries.map((e:any)=>e.subject),['edge-before']);
  assert.deepEqual((await get('owner','?from=2026-03-11&to=2026-03-11')).body.entries.map((e:any)=>e.subject),['=HYPERLINK("http://x")']);

  // category and actor filters hold across pages: 60 stock events = a page of 50 and a page of 10, no repeats or gaps
  const seen:string[]=[];let cursor:string|null=null;let pages=0;
  do{const p:any=await get('owner','?category=stock&actor='+ids.manager+(cursor?'&cursor='+cursor:''));assert.equal(p.status,200);seen.push(...p.body.entries.map((e:any)=>e.id));assert.ok(p.body.entries.every((e:any)=>e.actor===ids.manager&&e.actorRole==='manager'));cursor=p.body.nextCursor;pages++;}while(cursor&&pages<5);
  assert.deepEqual([pages,seen.length,new Set(seen).size],[2,60,60]);
  assert.equal((await get('owner','?category=stock&actor='+ids.staff)).body.entries.length,0);
  assert.deepEqual((await get('owner','?category=settings&from=2026-03-01&to=2026-03-31')).body.entries.map((e:any)=>e.action),['receipt.settings']);
  assert.deepEqual((await get('owner','?category=sales&from=2026-03-01&to=2026-03-31')).body.entries.map((e:any)=>e.action),['refund.required']);

  // strict query: unknown/duplicate keys, bad enums, inverted range, malformed or foreign cursor
  for(const bad of ['?x=1','?category=nope','?category=cash&category=stock','?from=2026-13-40','?from=2026-03-12&to=2026-03-01','?cursor=zz','?actor=a%20b','?actor='+'a'.repeat(65)])assert.equal((await get('owner',bad)).status,422,bad);
  const foreignId=(await get('other')).body.entries[0].id;assert.equal((await get('owner','?cursor='+foreignId)).status,404);

  // the application role can add history but never edit or delete it
  await assert.rejects(f.tenant(f.merchant,async db=>{await db.query('SET LOCAL ROLE bitpos_app');await db.query("UPDATE audit_logs SET action='x' WHERE merchant_id=$1",[f.merchant]);}),/permission denied/);
  await assert.rejects(f.tenant(f.merchant,async db=>{await db.query('SET LOCAL ROLE bitpos_app');await db.query('DELETE FROM audit_logs WHERE merchant_id=$1',[f.merchant]);}),/permission denied/);
  await f.tenant(f.merchant,async db=>{await db.query('SET LOCAL ROLE bitpos_app');await db.query("INSERT INTO audit_logs(merchant_id,actor,action,subject) VALUES($1,'t','test.insert','ok')",[f.merchant]);});

  // CSV for the same window holds exactly the viewer's entries; a formula-looking subject is neutralised; staff cannot export
  const window='from=2026-03-01&to=2026-03-31';
  const viewer:string[]=[];cursor=null;do{const p:any=await get('owner',`?${window}`+(cursor?'&cursor='+cursor:''));viewer.push(...p.body.entries.map((e:any)=>e.id));cursor=p.body.nextCursor;}while(cursor);
  const sheet=await call('owner','GET','/api/reports/export?kind=audit&'+window);assert.equal(sheet.status,200);
  const lines=(sheet.body.csv as string).split('\r\n').filter(Boolean);assert.equal(lines[0],'entry_id,created_at_utc,local_day,actor,actor_role,action,subject');
  assert.deepEqual(lines.slice(1).map(l=>l.split(',')[0]!).sort(),[...viewer].sort(),'CSV ids = screen ids');
  assert.ok(sheet.body.csv.includes(`"'=HYPERLINK(""http://x"")"`),'formula-safe cell');
  assert.equal((await call('staff','GET','/api/reports/export?kind=audit&'+window)).status,403);
  assert.equal((await call('other','GET','/api/reports/export?kind=audit&'+window)).body.csv.includes('=HYPERLINK'),false);
 }finally{await cleanup();}
});

test('receipt settings: anyone reads, only the owner saves, stale or racing saves conflict, input is validated and audited',integration,async()=>{
 const {f,call,admin,cleanup}=await harness();
 try{
  const first=await call('staff','GET','/api/receipt-settings');assert.equal(first.status,200);
  const s0=first.body.settings;assert.deepEqual([s0.configured,s0.revision,s0.defaultLang,s0.paperMm,s0.footer],[false,0,'th',80,'']);assert.ok(s0.shopName.length>0,'falls back to the shop name');
  assert.equal((await call(null,'GET','/api/receipt-settings')).status,401);
  const body=(over:Record<string,unknown>={})=>({shopName:'ร้านกาแฟทดสอบ',shopNameEn:'Test Cafe',footer:'ขอบคุณค่ะ',footerEn:'Thank you!',defaultLang:'both',paperMm:58,expectedRevision:0,...over});
  assert.equal((await call('staff','PUT','/api/receipt-settings',body())).status,403);
  assert.equal((await call('manager','PUT','/api/receipt-settings',body())).status,403);
  for(const bad of [{paperMm:70},{defaultLang:'fr'},{shopName:'x'.repeat(81)},{footer:'y'.repeat(161)},{extra:1},{expectedRevision:-1},{expectedRevision:'0'}])assert.equal((await call('owner','PUT','/api/receipt-settings',body(bad))).status,422,JSON.stringify(bad));
  const saved=await call('owner','PUT','/api/receipt-settings',body());assert.equal(saved.status,200);
  assert.deepEqual([saved.body.settings.revision,saved.body.settings.configured,saved.body.settings.paperMm,saved.body.settings.defaultLang,saved.body.settings.footerEn],[1,true,58,'both','Thank you!']);
  assert.equal((await call('staff','GET','/api/receipt-settings')).body.settings.shopNameEn,'Test Cafe');
  // stale first-save is a conflict; two concurrent edits from revision 1: exactly one wins
  assert.equal((await call('owner','PUT','/api/receipt-settings',body())).status,409);
  const race=await Promise.all([call('owner','PUT','/api/receipt-settings',body({expectedRevision:1,footer:'A'})),call('owner','PUT','/api/receipt-settings',body({expectedRevision:1,footer:'B'}))]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const now=(await call('manager','GET','/api/receipt-settings')).body.settings;assert.equal(now.revision,2);assert.ok(['A','B'].includes(now.footer));
  // another shop is untouched
  assert.equal((await call('other','GET','/api/receipt-settings')).body.settings.configured,false);
  // blank shop name falls back to the registered name, never to an empty header
  assert.ok((await call('owner','PUT','/api/receipt-settings',body({expectedRevision:2,shopName:''}))).body.settings.shopName.length>0);
  const audits=await f.tenant(f.merchant,async db=>(await db.query("SELECT subject FROM audit_logs WHERE merchant_id=$1 AND action='receipt.settings' ORDER BY subject",[f.merchant])).rows.map((r:any)=>r.subject));
  assert.deepEqual(audits,['rev:1','rev:2','rev:3']);
 }finally{await cleanup();}
});

test('reprint: only a paid order or a cash sale, copy numbers never repeat under a race, every reprint is in the audit timeline',integration,async()=>{
 const {f,call,admin,cleanup}=await harness();
 try{
  const sql=<T>(fn:(db:any)=>Promise<T>)=>f.tenant(f.merchant,fn);
  const open=await f.create(await f.quote(1));const openId=open.order.id as string;
  const paidId=await sql(async db=>{
   const customer=(await db.query('SELECT customer_id FROM orders WHERE id=$1',[openId])).rows[0].customer_id;
   return (await db.query("INSERT INTO orders(merchant_id,customer_id,thb_minor,usdg_minor,treasury,terminal_id,idempotency_key,access_token,request_hash,quote_expires_at,status,created_at,paid_at) VALUES($1,$2,3500,1000000,'11111111111111111111111111111111','reprint-fixture',$3,$4,'h',now()+interval '1 hour','PAID',now(),now()) RETURNING id",[f.merchant,customer,randomUUID(),randomUUID()])).rows[0].id as string;
  });
  // validation, anonymous, unknown id, an unpaid order, another shop's id
  assert.equal((await call(null,'POST','/api/receipts/reprint',{kind:'order',id:paidId})).status,401);
  for(const bad of [{},{kind:'order'},{kind:'bill',id:paidId},{kind:'order',id:'nope'},{kind:'order',id:paidId,x:1}])assert.equal((await call('staff','POST','/api/receipts/reprint',bad)).status,422,JSON.stringify(bad));
  assert.equal((await call('staff','POST','/api/receipts/reprint',{kind:'order',id:randomUUID()})).status,404);
  const unpaid=await call('staff','POST','/api/receipts/reprint',{kind:'order',id:openId});assert.deepEqual([unpaid.status,unpaid.body.error?.code],[409,'ORDER_NOT_PAID']);
  assert.equal((await call('other','POST','/api/receipts/reprint',{kind:'order',id:paidId})).status,404);
  // a kind that does not match the id is not found rather than guessed
  assert.equal((await call('staff','POST','/api/receipts/reprint',{kind:'cash',id:paidId})).status,404);

  // copies count up, even when five tills reprint the same bill at once
  const one=await call('staff','POST','/api/receipts/reprint',{kind:'order',id:paidId});assert.deepEqual([one.status,one.body.copy],[200,2]);
  const rush=await Promise.all(Array.from({length:5},()=>call('manager','POST','/api/receipts/reprint',{kind:'order',id:paidId})));
  assert.deepEqual(rush.map(r=>r.status),[200,200,200,200,200]);assert.deepEqual(rush.map(r=>r.body.copy).sort(),[3,4,5,6,7]);
  // the bill's own timeline shows every reprint, and the audit viewer files them under orders & bills
  const detail=await call('staff','GET',`/api/bills/orders/${paidId}`);assert.equal(detail.body.timeline.filter((t:any)=>t.action==='receipt.reprint').length,6);
  assert.equal((await call('owner','GET','/api/activity?category=sales')).body.entries.filter((e:any)=>e.action==='receipt.reprint').length,6);

  // cash sale (also a voided one, which prints stamped)
  assert.equal((await call('owner','PUT','/api/cash/settings',{enabled:true,currency:'THB',decimals:2,vatMode:'none',vatBps:700,sellerName:'ร้านทดสอบ',sellerTaxId:'',sellerBranch:'00000',sellerAddress:'',receiptPrefix:'H',staffMaxDiscountBps:0})).status,200);
  assert.equal((await call('manager','PUT','/api/cash/prices',{set:[{productId:f.product,priceMinor:'6500'}]})).status,200);
  const sale=await call('staff','POST','/api/cash/sales',{idempotencyKey:randomUUID(),items:[{productId:f.product,qty:1}],tenderMinor:'10000'});assert.equal(sale.status,200);const cashId=sale.body.sale.id as string;
  assert.equal((await call('staff','POST','/api/receipts/reprint',{kind:'cash',id:cashId})).body.copy,2);
  assert.equal((await call('manager','POST',`/api/cash/sales/${cashId}/void`,{reason:'คิดเงินผิด',restock:true})).status,200);
  assert.equal((await call('staff','POST','/api/receipts/reprint',{kind:'cash',id:cashId})).body.copy,3);
  assert.equal((await call('other','POST','/api/receipts/reprint',{kind:'cash',id:cashId})).status,404);
 }finally{await cleanup();}
});
