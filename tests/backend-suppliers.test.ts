import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('suppliers: owner/manager directory with idempotent create, optimistic edits, deactivate-only, tenant and role fenced',integration,async()=>{
 const f=await tableFixture(10);
 // Loading boundary: skipped integration never loads private runtime config.
 const {suppliersRequest}=await import('../apps/api/src/suppliers');
 const run=(merchant:string,role:string,path:string,method:string,input?:unknown)=>f.tenant(merchant,db=>suppliersRequest(db,merchant,'fa000000-0000-4000-8000-000000000010',role,new URL('http://localhost'+path),method,input));
 type S={id:string;name:string;version:number;active:boolean};
 const key=randomUUID();
 const made=await run(f.merchant,'owner','/api/suppliers','POST',{name:'  Coffee Supply Co. ',supplies:'Beans',idempotencyKey:key}) as {supplier:S;replayed:boolean};
 assert.equal(made.supplier.name,'Coffee Supply Co.');assert.equal(made.replayed,false);assert.equal(made.supplier.version,1);
 const again=await run(f.merchant,'manager','/api/suppliers','POST',{name:'Coffee Supply Co.',supplies:'Beans',idempotencyKey:key}) as {supplier:S;replayed:boolean};
 assert.equal(again.replayed,true);assert.equal(again.supplier.id,made.supplier.id,'a retried create does not duplicate');
 await assert.rejects(run(f.merchant,'owner','/api/suppliers','POST',{name:'Different',idempotencyKey:key}),(e:{code?:string})=>e.code==='IDEMPOTENCY_CONFLICT');
 const path='/api/suppliers/'+made.supplier.id;
 const edited=await run(f.merchant,'owner',path,'PATCH',{expectedVersion:1,phone:'0812345678'}) as {supplier:S};
 assert.equal(edited.supplier.version,2);
 await assert.rejects(run(f.merchant,'owner',path,'PATCH',{expectedVersion:1,name:'Stale'}),(e:{code?:string})=>e.code==='VERSION_CONFLICT');
 const off=await run(f.merchant,'owner',path,'PATCH',{expectedVersion:2,active:false}) as {supplier:S};
 assert.equal(off.supplier.active,false);
 const list=await run(f.merchant,'owner','/api/suppliers','GET') as {suppliers:S[]};
 assert.deepEqual(list.suppliers.map(s=>s.id),[made.supplier.id],'deactivated rows stay listed');
 for(const bad of [{expectedVersion:3},{expectedVersion:3,name:''},{expectedVersion:3,extra:1},{name:'x'}])
  await assert.rejects(run(f.merchant,'owner',path,'PATCH',bad),(e:{status?:number})=>e.status===422);
 await assert.rejects(run(f.merchant,'owner','/api/suppliers','POST',{name:'',idempotencyKey:randomUUID()}),(e:{status?:number})=>e.status===422);
 await assert.rejects(run(f.merchant,'cashier','/api/suppliers','GET'),(e:{status?:number})=>e.status===403);
 await assert.rejects(run(f.merchant,'owner','/api/suppliers/00000000-0000-4000-8000-0000000000aa','PATCH',{expectedVersion:1,active:true}),(e:{status?:number})=>e.status===404);
 const other=(await f.tenant(f.merchant,db=>db.query('SELECT id FROM merchants WHERE id<>$1 LIMIT 1',[f.merchant]))).rows[0]?.id;
 if(other)assert.deepEqual(((await run(other,'owner','/api/suppliers','GET')) as {suppliers:S[]}).suppliers,[],'another shop sees none');
});
