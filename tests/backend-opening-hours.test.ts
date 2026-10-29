import test from 'node:test';
import assert from 'node:assert/strict';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const week={'1':[{opens:'08:00',closes:'18:00'}]};
test('opening hours: revisioned owner/manager settings, tenant isolation and audit',integration,async()=>{
 const f=await tableFixture();
 // Loading boundary: skipped integration never loads private runtime config.
 const {openingHoursSettings}=await import('../apps/api/src/opening-hours');
 const call=(merchant:string,role:string,method:string,input?:unknown)=>f.tenant(merchant,db=>openingHoursSettings(db,merchant,f.actor,role,method,input));
 const initial=await call(f.merchant,'owner','GET');
 assert.deepEqual({configured:initial.configured,revision:initial.revision,timeZone:initial.timeZone},{configured:false,revision:0,timeZone:'Asia/Bangkok'});
 await assert.rejects(call(f.merchant,'staff','GET'),/ROLE_REQUIRED/);
 await assert.rejects(call(f.merchant,'staff','PUT',{expectedRevision:0,timeZone:'Asia/Bangkok',week}),/ROLE_REQUIRED/);
 const saved=await call(f.merchant,'manager','PUT',{expectedRevision:0,timeZone:'Asia/Bangkok',week});
 assert.deepEqual({configured:saved.configured,revision:saved.revision},{configured:true,revision:1});
 assert.deepEqual(saved.week['1'],week['1']);
 await assert.rejects(call(f.merchant,'owner','PUT',{expectedRevision:0,timeZone:'Asia/Bangkok',week}),/OPENING_HOURS_CHANGED/);
 await assert.rejects(call(f.merchant,'owner','PUT',{expectedRevision:1,timeZone:'Nope/Zone',week}),/INVALID_REQUEST/);
 await assert.rejects(call(f.merchant,'owner','PUT',{expectedRevision:1,timeZone:'Asia/Bangkok',week:{'1':[{opens:'18:00',closes:'08:00'}]}}),/INVALID_REQUEST/);
 assert.equal((await call(f.merchant,'owner','GET')).revision,1,'rejected writes change nothing');
 const second=await call(f.merchant,'owner','PUT',{expectedRevision:1,timeZone:'UTC',week:{'2':[{opens:'09:00',closes:'10:00'}]}});
 assert.deepEqual({revision:second.revision,timeZone:second.timeZone,monday:second.week['1'].length,tuesday:second.week['2'].length},{revision:2,timeZone:'UTC',monday:0,tuesday:1});
 assert.equal((await call(f.other,'owner','GET')).configured,false,'another merchant never sees these hours');
 const audits=await f.tenant(f.merchant,async db=>(await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE merchant_id=$1 AND action='opening_hours.configure'",[f.merchant])).rows[0].n);
 assert.equal(audits,2);
});
