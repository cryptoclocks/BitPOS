import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('activity history: newest-first keyset pages, merchant scoped, owner/manager only, read-only',integration,async()=>{
 const f=await tableFixture();
 // Loading boundary: skipped integration never loads private runtime config.
 const {activityHistory}=await import('../apps/api/src/activity');
 const call=(merchant:string,role:string,query='')=>f.tenant(merchant,db=>activityHistory(db,merchant,role,new URL('http://localhost/api/activity'+query)));
 const base=await call(f.merchant,'owner');const baseline=base.entries.length;
 await f.tenant(f.merchant,async db=>{for(let i=0;i<55;i++)await db.query("INSERT INTO audit_logs(merchant_id,actor,action,subject,created_at) VALUES($1,$2,'test.event',$3,clock_timestamp()+($4||' milliseconds')::interval)",[f.merchant,'actor-'+i,'subject-'+i,String(i+1000)]);});
 await f.tenant(f.other,db=>db.query("INSERT INTO audit_logs(merchant_id,actor,action,subject) VALUES($1,'other-actor','other.event','other-subject')",[f.other]));
 const first=await call(f.merchant,'manager');
 assert.equal(first.entries.length,50);assert.ok(first.nextCursor);
 assert.equal(first.entries[0].subject,'subject-54','newest first');
 assert.equal(JSON.stringify(first).includes('other-subject'),false,'another merchant\'s entries never appear');
 const second=await call(f.merchant,'owner','?cursor='+first.nextCursor);
 assert.equal(second.entries.length,5+baseline,'55 inserted + earlier entries, minus the 50 already shown');
 assert.equal(second.nextCursor,null);
 const ids=new Set([...first.entries,...second.entries].map(e=>e.id));assert.equal(ids.size,55+baseline,'pages never overlap or skip');
 await assert.rejects(call(f.merchant,'staff'),/ROLE_REQUIRED/);
 await assert.rejects(call(f.merchant,'owner','?cursor=nope'),/INVALID_REQUEST/);
 await assert.rejects(call(f.merchant,'owner','?x=1'),/INVALID_REQUEST/);
 await assert.rejects(call(f.merchant,'owner','?cursor='+randomUUID()+'&cursor='+randomUUID()),/INVALID_REQUEST/);
 await assert.rejects(call(f.other,'owner','?cursor='+first.nextCursor),/RESOURCE_NOT_FOUND/,'a cursor from another merchant is not usable');
});
