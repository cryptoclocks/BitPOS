import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture} from './backend-table-fixture';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
const week=(extra:Record<string,{opens:string;closes:string}[]>={})=>({'1':[{opens:'08:00',closes:'18:00'}],...extra});
test('DS45 branch discovery: server-computed openNow/nextOpenAt from existing opening hours',integration,async()=>{
 const f=await tableFixture();
 const {openingHoursSettings}=await import('../apps/api/src/opening-hours');
 const save=async(merchant:string,timeZone:string,w:unknown)=>{const cur=await f.tenant(merchant,db=>openingHoursSettings(db,merchant,f.actor,'owner','GET',undefined));
  await f.tenant(merchant,db=>openingHoursSettings(db,merchant,f.actor,'owner','PUT',{expectedRevision:cur.revision,timeZone,week:w}));};
 const state=async(merchant:string,at:string)=>(await f.pool.query<{open_now:boolean|null;next_open:Date|null}>('SELECT * FROM bitpos.branch_open_state($1,$2::timestamptz)',[merchant,at])).rows[0];
 const iso=(d:Date|null)=>d&&d.toISOString();
 // Unconfigured: unknown, never "closed".
 assert.deepEqual(await state(f.merchant,'2026-11-02T03:00:00Z'),{open_now:null,next_open:null});
 await save(f.merchant,'Asia/Bangkok',week({'3':[{opens:'09:00',closes:'12:00'}]}));
 // Monday 2026-11-02, Bangkok = UTC+7.
 let s=await state(f.merchant,'2026-11-02T03:00:00Z');assert.deepEqual({o:s.open_now,n:s.next_open},{o:true,n:null},'10:00 local is open');
 s=await state(f.merchant,'2026-11-02T00:30:00Z');assert.deepEqual({o:s.open_now,n:iso(s.next_open)},{o:false,n:'2026-11-02T01:00:00.000Z'},'07:30 local opens at 08:00 local the same day');
 s=await state(f.merchant,'2026-11-02T11:00:00Z');assert.deepEqual({o:s.open_now,n:iso(s.next_open)},{o:false,n:'2026-11-04T02:00:00.000Z'},'closes is exclusive; next window is Wednesday 09:00 local');
 s=await state(f.merchant,'2026-11-02T17:30:00Z');assert.equal(s.open_now,false,'00:30 Tuesday local is closed although UTC is still Monday');
 s=await state(f.merchant,'2026-11-01T17:30:00Z');assert.deepEqual({o:s.open_now,n:iso(s.next_open)},{o:false,n:'2026-11-02T01:00:00.000Z'},'Sunday 17:30Z is Monday 00:30 local: weekday follows the zone, not UTC');
});
test('DS45 branch discovery: zone, week wrap, empty week and HTTP-level branch list',integration,async t=>{
 const f=await tableFixture();
 const {openingHoursSettings}=await import('../apps/api/src/opening-hours');
 const {mobileFoodRequest}=await import('../apps/api/src/mobile-food');
 const {MobileBranchesSchema}=await import('../packages/contracts/src/mobile-v1.generated');
 const save=(merchant:string,timeZone:string,w:unknown)=>f.tenant(merchant,async db=>{const cur=await openingHoursSettings(db,merchant,f.actor,'owner','GET',undefined);
  await openingHoursSettings(db,merchant,f.actor,'owner','PUT',{expectedRevision:cur.revision,timeZone,week:w});});
 const state=async(merchant:string,at:string)=>(await f.pool.query<{open_now:boolean|null;next_open:Date|null}>('SELECT * FROM bitpos.branch_open_state($1,$2::timestamptz)',[merchant,at])).rows[0];
 const days=(w:{opens:string;closes:string}[])=>Object.fromEntries(['0','1','2','3','4','5','6'].map(d=>[d,w]));
 // Window on Sunday only: Saturday evening wraps to Sunday.
 await save(f.merchant,'UTC',{'0':[{opens:'10:00',closes:'11:00'}]});
 let s=await state(f.merchant,'2026-11-07T20:00:00Z');// Saturday UTC
 assert.deepEqual({o:s.open_now,n:s.next_open?.toISOString()},{o:false,n:'2026-11-08T10:00:00.000Z'});
 s=await state(f.merchant,'2026-11-08T10:30:00Z');assert.equal(s.open_now,true);
 s=await state(f.merchant,'2026-11-08T11:00:00Z');assert.deepEqual({o:s.open_now,n:s.next_open?.toISOString()},{o:false,n:'2026-11-15T10:00:00.000Z'},'same weekday next week');
 await save(f.merchant,'Asia/Bangkok',days([]));
 s=await state(f.merchant,'2026-11-02T03:00:00Z');assert.deepEqual({o:s.open_now,n:s.next_open},{o:false,n:null},'configured but never open: closed, no hint');
 // Branch list: only enabled branches; openNow derived on the server, not accepted from the client.
 const {default:pg}=await import('pg');const {config}=await import('../apps/api/src/config');const admin=new pg.Client({connectionString:config.ADMIN_DATABASE_URL});await admin.connect();t.after(()=>admin.end());
 const branch=randomUUID(),plain=randomUUID();
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,enabled,pickup_enabled)VALUES($1,$2,'Open now fixture',true,true),($3,$4,'No hours fixture',true,true)",[f.merchant,branch,f.other,plain]);
 await save(f.merchant,'Asia/Bangkok',days([{opens:'00:00',closes:'23:59'}]));
 const list=async(search:string)=>MobileBranchesSchema.parse(await mobileFoodRequest(new URL('http://x/api/mobile/v1/branches?search='+encodeURIComponent(search)),'GET',undefined,undefined)).branches;
 const open=(await list('Open now fixture')).find(b=>b.id===branch)!;
 assert.equal(open.openNow,true,'window covers the whole local day except the final minute');
 assert.equal(open.nextOpenAt,null,'open branches carry no next-open hint');
 assert.equal((await list('No hours fixture')).find(b=>b.id===plain)!.openNow,null);
 await assert.rejects(mobileFoodRequest(new URL('http://x/api/mobile/v1/branches?openNow=true'),'GET',undefined,undefined),/INVALID_REQUEST/,'client cannot supply openNow');
 await save(f.merchant,'Asia/Bangkok',days([]));
 const closed=(await list('Open now fixture')).find(b=>b.id===branch)!;
 assert.deepEqual({o:closed.openNow,n:closed.nextOpenAt},{o:false,n:null});
 const one=await f.pool.query("SELECT profile FROM bitpos.mobile_public_branches($1,NULL,1,'','all')",[branch]);
 assert.equal(one.rows[0].profile.openNow,false,'menu branch profile shares the same server computation');
});
