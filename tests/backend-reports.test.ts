import test from 'node:test';
import assert from 'node:assert/strict';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('sales report: paid orders only, merchant-local days, one group per denomination, role and tenant fenced',integration,async()=>{
 const f=await tableFixture(10);
 // Loading boundary: skipped integration never loads private runtime config.
 const {salesReport}=await import('../apps/api/src/reports');
 const call=(merchant:string,role:string,query:string)=>f.tenant(merchant,db=>salesReport(db,merchant,role,new URL('http://localhost/api/reports/sales?'+query)));
 // One live order per display: re-pair the register to a fresh device before each further order.
 let generation=1;
 const order=async(qty:number,first=false)=>{
  if(!first){const device=await f.reg('/api/devices','POST',{label:'Extra '+generation});generation++;await f.reg('/api/devices/'+device.id+'/credential','POST',{});await f.tenant(f.merchant,db=>db.query("UPDATE device_presence SET connection_generation=1,connection_id=gen_random_uuid(),connected_until=clock_timestamp()+interval '1 hour' WHERE device_id=$1",[device.id]));await f.reg('/api/registers/'+f.register.id+'/pairing','PUT',{deviceId:device.id,expectedPairingGeneration:String(generation)});}
  return f.create(await f.quote(qty));
 };
 const a=await order(1,true),b=await order(2),c=await order(1),unpaid=await order(1);
 // 2026-10-25 23:30 Bangkok = 2026-10-25T16:30Z ; 2026-10-26 00:30 Bangkok = 2026-10-25T17:30Z ; 2026-10-26 12:00 Bangkok = 05:00Z
 const set=(id:string,at:string)=>f.tenant(f.merchant,db=>db.query("UPDATE orders SET status='PAID',paid_at=$2 WHERE id=$1",[id,at]));
 await set(a.order.id,'2026-10-25T16:30:00Z');await set(b.order.id,'2026-10-25T17:30:00Z');await set(c.order.id,'2026-10-26T05:00:00Z');
 const report=await call(f.merchant,'owner','from=2026-10-25&to=2026-10-26');
 assert.equal(report.timeZone,'Asia/Bangkok');assert.equal(report.basis,'gross_paid_before_refunds_and_fees');assert.equal(report.excludedOrders,0);
 assert.deepEqual(report.days.map(d=>d.day),['2026-10-26','2026-10-25'],'newest day first');
 const counts=(day:string)=>report.days.find(d=>d.day===day)!.groups.reduce((n,g)=>n+g.orders,0);
 assert.equal(counts('2026-10-25'),1,'23:30 Bangkok belongs to the 25th');assert.equal(counts('2026-10-26'),2,'00:30 and 12:00 Bangkok belong to the 26th');
 for(const day of report.days)for(const g of day.groups){assert.match(g.totalMinor,/^[0-9]+$/);assert.ok(g.currency&&Number.isInteger(g.decimals));}
 const all=report.days.flatMap(d=>d.groups);assert.equal(all.reduce((n,g)=>n+g.orders,0),3,'the unpaid order is not counted');
 const total=all.filter(g=>g.currency===all[0].currency&&g.decimals===all[0].decimals).reduce((n,g)=>n+BigInt(g.totalMinor),0n);
 const expected=[a,b,c].reduce((n,o)=>n+BigInt(o.order.pricing.total.amountMinor),0n);
 assert.equal(total,expected,'sum equals the canonical order totals');
 assert.equal((await call(f.merchant,'owner','from=2026-10-26&to=2026-10-26')).days.length,1);
 assert.equal((await call(f.merchant,'owner','from=2026-11-01&to=2026-11-02')).days.length,0);
 assert.equal((await call(f.other,'owner','from=2026-10-25&to=2026-10-26')).days.length,0,'another merchant sees nothing');
 await assert.rejects(call(f.merchant,'staff','from=2026-10-25&to=2026-10-26'),/ROLE_REQUIRED/);
 for(const bad of ['','from=2026-10-25','from=2026-10-26&to=2026-10-25','from=2026-02-30&to=2026-03-01','from=2025-01-01&to=2026-12-31','from=2026-10-25&to=2026-10-26&x=1','from=2026-10-25&from=2026-10-24&to=2026-10-26'])await assert.rejects(call(f.merchant,'owner',bad),/INVALID_REQUEST/,bad);
 assert.ok(unpaid.order.id);
});
