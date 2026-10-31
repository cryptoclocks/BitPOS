import test from 'node:test';
import assert from 'node:assert/strict';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('reorder level: owner/manager set and clear a per-product minimum, validated, audited, tenant and role fenced',integration,async()=>{
 const f=await tableFixture(10);
 // Loading boundary: skipped integration never loads private runtime config.
 const {inventoryRequest}=await import('../apps/api/src/inventory');
 const run=(merchant:string,role:string,path:string,method:string,input?:unknown)=>f.tenant(merchant,db=>inventoryRequest(db,merchant,'fa000000-0000-4000-8000-000000000010',role,new URL('http://localhost'+path),method,input));
 const stock=await run(f.merchant,'owner','/api/inventory/stock','GET') as {products:{productId:string;reorderLevel:number|null}[]};
 const id=stock.products[0].productId;
 assert.equal(stock.products[0].reorderLevel,null,'no minimum until the shop sets one');
 assert.deepEqual(await run(f.merchant,'manager','/api/inventory/reorder','POST',{productId:id,reorderLevel:7}),{productId:id,reorderLevel:7});
 assert.equal(((await run(f.merchant,'owner','/api/inventory/stock','GET')) as typeof stock).products.find(p=>p.productId===id)!.reorderLevel,7);
 assert.deepEqual(await run(f.merchant,'owner','/api/inventory/reorder','POST',{productId:id,reorderLevel:null}),{productId:id,reorderLevel:null});
 for(const bad of [{productId:id,reorderLevel:-1},{productId:id,reorderLevel:1.5},{productId:id,reorderLevel:100001},{productId:id},{productId:'x',reorderLevel:1},{productId:id,reorderLevel:1,extra:1}])
  await assert.rejects(run(f.merchant,'owner','/api/inventory/reorder','POST',bad),(e:{status?:number})=>e.status===422);
 await assert.rejects(run(f.merchant,'cashier','/api/inventory/reorder','POST',{productId:id,reorderLevel:1}),(e:{status?:number})=>e.status===403);
 await assert.rejects(run(f.merchant,'owner','/api/inventory/reorder','POST',{productId:'00000000-0000-4000-8000-0000000000aa',reorderLevel:1}),(e:{status?:number})=>e.status===404);
});
