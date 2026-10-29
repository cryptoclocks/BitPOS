import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('inventory: ledgered receive/adjust with optimistic stock, idempotency, reserved-stock floor, tenant and role fences',integration,async()=>{
 const f=await tableFixture(5);
 // Loading boundary: skipped integration never loads private runtime config.
 const {inventoryRequest}=await import('../apps/api/src/inventory');
 const call=(merchant:string,role:string,method:string,path:string,input?:unknown)=>f.tenant(merchant,db=>inventoryRequest(db,merchant,f.actor,role,new URL('http://localhost'+path),method,input)) as Promise<any>;
 const body=(over:Record<string,unknown>={})=>({productId:f.product,kind:'RECEIVE',delta:3,reason:'Delivery from supplier',reference:'INV-1',expectedStock:5,idempotencyKey:randomUUID(),...over});
 const stock=async()=>(await call(f.merchant,'owner','GET','/api/inventory/stock')).products.find((p:any)=>p.productId===f.product);
 assert.deepEqual(await stock(),{productId:f.product,stock:5,reserved:0,available:5});
 const key=randomUUID();
 const first=await call(f.merchant,'manager','POST','/api/inventory/movements',body({idempotencyKey:key}));
 assert.deepEqual([first.replayed,first.movement.stockBefore,first.movement.stockAfter,first.movement.delta],[false,5,8,3]);
 assert.equal((await stock()).stock,8);
 const replay=await call(f.merchant,'manager','POST','/api/inventory/movements',body({idempotencyKey:key}));
 assert.deepEqual([replay.replayed,replay.movement.id],[true,first.movement.id]);assert.equal((await stock()).stock,8,'replay changes nothing');
 await assert.rejects(call(f.merchant,'manager','POST','/api/inventory/movements',body({idempotencyKey:key,delta:4})),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(call(f.merchant,'owner','POST','/api/inventory/movements',body({expectedStock:5})),/STOCK_CHANGED/,'stale quantity refused');
 const adjust=await call(f.merchant,'owner','POST','/api/inventory/movements',body({kind:'ADJUST',delta:-2,reason:'Spoiled',reference:'',expectedStock:8}));
 assert.deepEqual([adjust.movement.stockAfter,adjust.movement.kind],[6,'ADJUST']);
 // reserved stock floor: an open order reserves 1; stock can never go below it
 const created=await f.create(await f.quote(1));assert.ok(created.order.id);
 const now=await stock();assert.equal(now.reserved,1);
 await assert.rejects(call(f.merchant,'owner','POST','/api/inventory/movements',body({kind:'ADJUST',delta:-6,reason:'Write off',expectedStock:6})),/STOCK_BELOW_RESERVED/);
 await assert.rejects(call(f.merchant,'owner','POST','/api/inventory/movements',body({kind:'ADJUST',delta:-7,reason:'Too far',expectedStock:6})),/STOCK_BELOW_RESERVED/);
 assert.equal((await stock()).stock,6,'refused changes leave stock untouched');
 for(const bad of [{delta:0},{kind:'RECEIVE',delta:-1},{reason:'  '},{delta:100001},{productId:'nope'},{extra:1}])await assert.rejects(call(f.merchant,'owner','POST','/api/inventory/movements',body(bad)),/INVALID_REQUEST/,JSON.stringify(bad));
 await assert.rejects(call(f.merchant,'owner','POST','/api/inventory/movements',body({productId:randomUUID(),expectedStock:0})),/RESOURCE_NOT_FOUND/);
 const history=await call(f.merchant,'owner','GET','/api/inventory/movements?productId='+f.product);
 assert.deepEqual(history.movements.map((m:any)=>m.delta),[-2,3],'newest first');assert.equal(history.nextCursor,null);
 await assert.rejects(call(f.merchant,'owner','GET','/api/inventory/movements?x=1'),/INVALID_REQUEST/);
 await assert.rejects(call(f.merchant,'staff','GET','/api/inventory/stock'),/ROLE_REQUIRED/);
 await assert.rejects(call(f.merchant,'staff','POST','/api/inventory/movements',body({expectedStock:6})),/ROLE_REQUIRED/);
 assert.equal((await call(f.other,'owner','GET','/api/inventory/movements')).movements.length,0,'another merchant sees no movements');
 await assert.rejects(call(f.other,'owner','POST','/api/inventory/movements',body({expectedStock:6})),/RESOURCE_NOT_FOUND/,'another merchant cannot move this product');
 await assert.rejects(f.pool.query('UPDATE stock_movements SET reason=$1 WHERE merchant_id=$2',['tamper',f.merchant]),/./,'ledger rows are immutable for the app role');
});
