import test from 'node:test';
import assert from 'node:assert/strict';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('merchant returns list: owner and manager only, tenant fenced, empty when the shop has no return cases',integration,async()=>{
 const f=await tableFixture(10);
 // Loading boundary: skipped integration never loads private runtime config.
 const {merchantReturns}=await import('../apps/api/src/merchant-returns');
 const call=(merchant:string,role:string,query='')=>f.tenant(merchant,db=>merchantReturns(db,merchant,role,new URL('http://localhost/api/returns'+query)));
 assert.deepEqual(await call(f.merchant,'owner'),{returns:[]});
 assert.deepEqual(await call(f.merchant,'manager','?limit=5'),{returns:[]});
 await assert.rejects(call(f.merchant,'cashier'),(error:{status?:number;code?:string})=>error.status===403||error.code==='ROLE_REQUIRED');
 await assert.rejects(call(f.merchant,'owner','?limit=0'),(error:{status?:number})=>error.status===422);
 await assert.rejects(call(f.merchant,'owner','?limit=5&limit=6'),(error:{status?:number})=>error.status===422);
 await assert.rejects(call(f.merchant,'owner','?other=1'),(error:{status?:number})=>error.status===422);
});
