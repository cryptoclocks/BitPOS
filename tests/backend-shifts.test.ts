import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('shift close: server-computed paid totals frozen in an immutable row, contiguous periods, idempotent, role fenced',integration,async()=>{
 const f=await tableFixture(10);
 // Loading boundary: skipped integration never loads private runtime config.
 const {shiftsRequest}=await import('../apps/api/src/shifts');
 const run=(role:string,path:string,method:string,input?:unknown,merchant=f.merchant)=>f.tenant(merchant,db=>shiftsRequest(db,merchant,'fa000000-0000-4000-8000-000000000010',role,new URL('http://localhost'+path),method,input));
 type Open={open:{periodStart:string;snapshot:{groups:{orders:number;totalMinor:string}[]}};closes:{id:string;periodStart:string;periodEnd:string;snapshot:{groups:{orders:number;totalMinor:string}[]};countedCash:{minor:string;currency:string;decimals:number}|null}[]};
 type Closed={close:Open['closes'][number];replayed:boolean};
 const quote=await f.quote(2),created=await f.create(quote);
 await f.tenant(f.merchant,db=>db.query("UPDATE orders SET status='PAID',paid_at=clock_timestamp() WHERE id=$1",[created.order.id]));
 const before=await run('owner','/api/shifts','GET') as Open;
 assert.equal(before.closes.length,0);
 assert.equal(before.open.snapshot.groups.reduce((n,g)=>n+g.orders,0),1,'the paid order is in the open period');
 const key=randomUUID();
 const first=await run('manager','/api/shifts/close','POST',{idempotencyKey:key,note:'  evening  ',countedCash:{minor:'520000',currency:'THB',decimals:2}}) as Closed;
 assert.equal(first.replayed,false);
 assert.equal(first.close.snapshot.groups.reduce((n,g)=>n+g.orders,0),1);
 assert.equal(BigInt(first.close.snapshot.groups[0].totalMinor),BigInt(created.order.pricing.total.amountMinor),'frozen total equals the canonical order total');
 assert.deepEqual(first.close.countedCash,{minor:'520000',currency:'THB',decimals:2});
 const replay=await run('owner','/api/shifts/close','POST',{idempotencyKey:key,note:'evening'}) as Closed;
 assert.equal(replay.replayed,true);assert.equal(replay.close.id,first.close.id,'a retried close does not create a second row');
 const second=await run('owner','/api/shifts/close','POST',{idempotencyKey:randomUUID()}) as Closed;
 assert.equal(second.close.periodStart,first.close.periodEnd,'periods are contiguous');
 assert.equal(second.close.snapshot.groups.length,0,'the first period\'s order is not counted twice');
 assert.equal(second.close.countedCash,null);
 const after=await run('owner','/api/shifts','GET') as Open;
 assert.deepEqual(after.closes.map(c=>c.id),[second.close.id,first.close.id],'newest first');
 for(const bad of [{idempotencyKey:'',note:''},{idempotencyKey:randomUUID(),countedCash:{minor:'-1',currency:'THB',decimals:2}},{idempotencyKey:randomUUID(),countedCash:{minor:'1.5',currency:'THB',decimals:2}},{idempotencyKey:randomUUID(),extra:1},{idempotencyKey:randomUUID(),note:'x'.repeat(201)}])
  await assert.rejects(run('owner','/api/shifts/close','POST',bad),(e:{status?:number})=>e.status===422);
 await assert.rejects(run('cashier','/api/shifts','GET'),(e:{status?:number})=>e.status===403);
 await assert.rejects(run('staff','/api/shifts/close','POST',{idempotencyKey:randomUUID()}),(e:{status?:number})=>e.status===403);
 await assert.rejects(f.tenant(f.merchant,db=>db.query("UPDATE shift_closes SET note='tampered' WHERE merchant_id=$1",[f.merchant])),/./,'closing records are immutable');
});
