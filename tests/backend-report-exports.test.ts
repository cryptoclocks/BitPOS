import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const parse=(csv:string)=>csv.split('\r\n').filter(Boolean).map(l=>l.split(','));
test('csv helpers: formulas are neutralised, quoting is correct, only integers pass as numbers',async()=>{
 const {csvText,csvInt}=await import('../apps/api/src/report-exports');
 for(const c of ['=1+1','+1','-1','@SUM(A1)','\tx','\rx'])assert.equal(csvText(c)[0]==='"'?csvText(c)[1]:csvText(c)[0],"'",c);
 assert.equal(csvText('a,"b"'),'"a,""b"""');assert.equal(csvText('plain'),'plain');
 assert.equal(csvInt('-5'),'-5');assert.equal(csvInt(0),'0');assert.equal(csvInt(12345678901234567890n),'12345678901234567890');
 for(const bad of ['1.5','=1','01','','1e3','-','--1',' 1'])assert.throws(()=>csvInt(bad),/integer/,bad);
});
test('report exports: sales, net-after-refunds, stock movements are role/tenant fenced, paged, exact and reconcile to the sales report',integration,async()=>{
 const f=await tableFixture(50);
 const {reportExport}=await import('../apps/api/src/report-exports');const {salesReport}=await import('../apps/api/src/reports');const {inventoryRequest}=await import('../apps/api/src/inventory');
 const exp=(merchant:string,role:string,query:string,size?:number)=>f.tenant(merchant,db=>reportExport(db,merchant,f.actor,role,new URL('http://localhost/api/reports/export?'+query),size));
 const drain=async(merchant:string,kind:string,from:string,to:string,size:number)=>{let cursor='',csv='',pages=0;for(;;){const page=await exp(merchant,'owner',`kind=${kind}&from=${from}&to=${to}${cursor?'&cursor='+cursor:''}`,size);csv+=page.csv;pages++;assert.ok(pages<50);if(!page.nextCursor)return {csv,pages};cursor=page.nextCursor;}};
 let generation=1;
 const order=async(qty:number,first=false)=>{
  if(!first){const device=await f.reg('/api/devices','POST',{label:'Extra '+generation});generation++;await f.reg('/api/devices/'+device.id+'/credential','POST',{});await f.tenant(f.merchant,db=>db.query("UPDATE device_presence SET connection_generation=1,connection_id=gen_random_uuid(),connected_until=clock_timestamp()+interval '1 hour' WHERE device_id=$1",[device.id]));await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:device.id,expectedPairingGeneration:String(generation)});}
  return f.create(await f.quote(qty));
 };
 const a=await order(1,true),b=await order(2);
 const set=(id:string,at:string)=>f.tenant(f.merchant,db=>db.query("UPDATE orders SET status='PAID',paid_at=$2 WHERE id=$1",[id,at]));
 await set(a.order.id,'2026-10-25T16:30:00Z');await set(b.order.id,'2026-10-26T05:00:00Z');
 const gross=BigInt(a.order.pricing.total.amountMinor);
 // sales
 const sales=await exp(f.merchant,'owner','kind=sales&from=2026-10-25&to=2026-10-26');
 const rows=parse(sales.csv);
 assert.deepEqual(rows[0],['order_id','paid_at_utc','local_day','source_kind','currency','decimals','total_minor']);
 assert.equal(rows.length,3);assert.equal(rows[1][0],a.order.id);assert.equal(rows[1][1],'2026-10-25T16:30:00.000Z');assert.equal(rows[1][2],'2026-10-25');assert.equal(rows[1][6],String(gross));assert.match(rows[1][6],/^[0-9]+$/);
 assert.equal(sales.timeZone,'Asia/Bangkok');assert.equal(sales.filename,'bitpos-sales-2026-10-25_2026-10-26.csv');
 const report=await f.tenant(f.merchant,db=>salesReport(db,f.merchant,'owner',new URL('http://localhost/x?from=2026-10-25&to=2026-10-26')));
 assert.equal(report.days.flatMap(d=>d.groups).reduce((n,g)=>n+BigInt(g.totalMinor),0n),gross+BigInt(b.order.pricing.total.amountMinor),'export equals report');
 assert.equal((await exp(f.merchant,'owner','kind=sales&from=2026-10-27&to=2026-10-27')).csv.split('\r\n').filter(Boolean).length,1,'empty range is header only');
 // net with a finalized refund (fixture rows written with FK triggers off, then removed)
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 const refund=1n,caseId=randomUUID(),attempt=randomUUID(),payment=randomUUID();
 try{
  await admin.query('SET session_replication_role=replica');await admin.query('SET search_path=bitpos,public');
  const q=a.order.id;
  await admin.query("INSERT INTO food_return108_financial_reviews(case_id,merchant_id,order_id,quote_id,catalog_currency,catalog_decimals,catalog_total_minor) VALUES($1,$2,$3,$4,$5,$6,$7)",[caseId,f.merchant,q,randomUUID(),report.days[0].groups[0].currency,report.days[0].groups[0].decimals,refund]);
  await admin.query("INSERT INTO food_return109_allocations(case_id,merchant_id,order_id,payment_id,amount_minor,asset_descriptor,settlement,beneficiary) VALUES($1,$2,$3,$4,1,'{}','{}','x')",[caseId,f.merchant,q,payment]);
  await admin.query("INSERT INTO food_refund110_attempts(id,binding_id,case_id,payment_id) VALUES($1,$2,$3,$4)",[attempt,randomUUID(),caseId,payment]);
  await admin.query("INSERT INTO food_refund112_receipts(attempt_id,outcome,verification_hash,evidence,created_at) VALUES($1,'FINALIZED',repeat('a',64),'{}','2026-10-26T05:00:00Z')",[attempt]);
  const net=parse((await exp(f.merchant,'owner','kind=net&from=2026-10-25&to=2026-10-26')).csv);
  assert.deepEqual(net[0],['order_id','currency','decimals','gross_minor','refunded_minor','net_minor']);
  assert.equal(net.length,3);const mine=net.find(r=>r[0]===a.order.id)!;assert.deepEqual(mine.slice(3),[String(gross),'1',String(gross-refund)],'net = gross - finalized refund');
  assert.equal(report.refunds.length,0,'(report fetched before the refund existed)');
  const after=await f.tenant(f.merchant,db=>salesReport(db,f.merchant,'owner',new URL('http://localhost/x?from=2026-10-25&to=2026-10-26')));
  assert.equal(BigInt(after.refunds[0].refundedMinor),refund,'export refund equals the report refund');
  // refund in a window where the order was not paid: refund-only row with negative net (integer, unquoted, not a formula)
  const only=parse((await exp(f.merchant,'owner','kind=net&from=2026-10-27&to=2026-10-27')).csv);
  assert.equal(only.length,1);
  await admin.query("UPDATE bitpos.food_refund112_receipts SET created_at='2026-10-27T05:00:00Z' WHERE attempt_id=$1",[attempt]);
  const refundOnly=parse((await exp(f.merchant,'owner','kind=net&from=2026-10-27&to=2026-10-27')).csv);
  assert.deepEqual(refundOnly[1].slice(3),['0','1','-1']);
  // another merchant never sees it
  assert.equal(parse((await exp(f.other,'owner','kind=net&from=2026-10-25&to=2026-10-26')).csv).length,1);
 }finally{
  await admin.query('DELETE FROM food_refund112_receipts WHERE attempt_id=$1',[attempt]);await admin.query('DELETE FROM food_refund110_attempts WHERE id=$1',[attempt]);await admin.query('DELETE FROM food_return109_allocations WHERE case_id=$1',[caseId]);await admin.query('DELETE FROM food_return108_financial_reviews WHERE case_id=$1',[caseId]);await admin.end();
 }
 // stock movements: 7 ledger entries incl. a formula-looking reason, paged by 3
 const inv=(role:string,input:unknown)=>f.tenant(f.merchant,db=>inventoryRequest(db,f.merchant,f.actor,role,new URL('http://localhost/api/inventory/movements'),'POST',input)) as Promise<any>;
 let stock=50;
 const reasons=['=HYPERLINK("http://x","y")','+cmd','-2+3','@SUM(1)','plain, with comma','say "hi"','ok'];
 for(const [i,reason] of reasons.entries()){const delta=i%2?-1:2;await inv('owner',{productId:f.product,kind:'ADJUST',delta,reason,reference:'',expectedStock:stock,idempotencyKey:randomUUID()});stock+=delta;}
 const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const paged=await drain(f.merchant,'stock',yesterday,tomorrow,3);
 assert.equal(paged.pages,3,'7 rows in pages of 3');
 const single=await exp(f.merchant,'owner',`kind=stock&from=${yesterday}&to=${tomorrow}`);
 assert.equal(paged.csv,single.csv,'paged export equals the one-shot export (no gaps or repeats, header once)');
 assert.equal(paged.csv.split('movement_id').length,2);
 const text=single.csv;
 for(const cell of ["'=HYPERLINK","'+cmd","'-2+3","'@SUM(1)",'"plain, with comma"','"say ""hi"""'])assert.ok(text.includes(cell),cell);
 assert.ok(!/(^|,)[=@]/m.test(text.split('\r\n').slice(1).join('\n').replace(/"[^"]*"/g,'')),'no unguarded formula cell');
 const body=single.csv.split('\r\n').filter(Boolean).slice(1);assert.equal(body.length,7);
 assert.match(body[1],/,-1,\d+,\d+,/,'signed integer delta is a plain number');
 assert.equal(single.rows,7);
 assert.equal((await exp(f.merchant,'owner',`kind=stock&from=${yesterday}&to=${yesterday}`)).rows,0);
 assert.equal((await exp(f.other,'owner',`kind=stock&from=${yesterday}&to=${tomorrow}`)).rows,0,'another merchant sees no movements');
 // sales paging with size 1 across more than one paid order
 const grossB=BigInt(b.order.pricing.total.amountMinor);
 const one=await drain(f.merchant,'sales','2026-10-25','2026-10-26',1);assert.equal(one.pages,2);
 assert.deepEqual(parse(one.csv).slice(1).map(r=>r[0]),[a.order.id,b.order.id],'paid_at order, no gaps or repeats');assert.equal(parse(one.csv).slice(1).reduce((n,r)=>n+BigInt(r[6]),0n),gross+grossB);
 // role + validation fences
 for(const kind of ['sales','net','stock'])await assert.rejects(exp(f.merchant,'staff',`kind=${kind}&from=2026-10-25&to=2026-10-26`),/ROLE_REQUIRED/);
 await assert.rejects(exp(f.merchant,'cashier','kind=sales&from=2026-10-25&to=2026-10-26'),/ROLE_REQUIRED/);
 for(const bad of ['','kind=sales','kind=x&from=2026-10-25&to=2026-10-26','kind=sales&from=2026-10-26&to=2026-10-25','kind=sales&from=2025-01-01&to=2026-12-31','kind=sales&from=2026-02-30&to=2026-03-01','kind=sales&from=2026-10-25&to=2026-10-26&x=1','kind=sales&kind=net&from=2026-10-25&to=2026-10-26','kind=sales&from=2026-10-25&to=2026-10-26&cursor=nope','kind=sales&from=2026-10-25&to=2026-10-26&cursor='+randomUUID(),'kind=stock&from=2026-10-25&to=2026-10-26&cursor='+randomUUID()])await assert.rejects(exp(f.merchant,'owner',bad),/INVALID_REQUEST/,bad);
 assert.ok((await f.tenant(f.merchant,db=>db.query("SELECT count(*)::int n FROM audit_logs WHERE merchant_id=$1 AND action='report.export'",[f.merchant]))).rows[0].n>=1,'first page of an export is audited');
});
