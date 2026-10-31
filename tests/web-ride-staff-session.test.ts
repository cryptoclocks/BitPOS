import test from 'node:test';
import assert from 'node:assert/strict';
import {RideStaffSession} from '../apps/web/src/lib/ride-staff-session';
import {PlatformError} from '../apps/web/src/lib/platform-session';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const command={expectedRateId:id(3),currency:'THB',decimals:2,baseMinor:'2500',perKmMinor:'700',perMinuteMinor:'100',minimumMinor:'5000',sharedDiscountBps:1000};
const rate={rateId:id(4),currency:'THB',decimals:2,baseMinor:'2500',perKmMinor:'700',perMinuteMinor:'100',minimumMinor:'5000',sharedDiscountBps:1000,publishedAt:'2026-10-27T00:00:00Z'};
const review={outcome:'FOLLOW_UP',note:'Review the reported concern'};
const reviewed={incidentId:id(5),outcome:'FOLLOW_UP',reviewedAt:'2026-10-27T00:00:00Z'};
async function fixture(run:(f:{api:RideStaffSession;calls:{path:string;init?:RequestInit}[];reply:(fn:()=>Promise<Response>)=>void})=>Promise<void>){
 const old=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('Staff ride data must not use browser storage');}});
 const calls:{path:string;init?:RequestInit}[]=[];let reply=async()=>Response.json(rate);
 globalThis.fetch=async(path,init)=>{const url=String(path);if(url.endsWith('/auth/verify'))return Response.json({accountId:id(1),sessionId:id(2),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'});if(url.endsWith('/auth/logout'))return Response.json({});calls.push({path:url,init});return reply();};
 try{const api=new RideStaffSession();await api.verify('+66900000001','123456');await run({api,calls,reply:fn=>{reply=fn;}});}finally{globalThis.fetch=old;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');}
}
test('fare publication preserves integer minor units and expected rate, uses PUT and no browser storage',()=>fixture(async f=>{
 assert.deepEqual(await f.api.publish(command),rate);assert.equal(f.calls[0].path,'/api/mobile/v1/rides/fare');assert.equal(f.calls[0].init?.method,'PUT');assert.equal(f.calls[0].init?.cache,'no-store');assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)),command);
 f.reply(async()=>Response.json({...rate,baseMinor:'2501'}));await assert.rejects(f.api.publish(command),(e:unknown)=>e instanceof PlatformError&&e.code==='INVALID_RECEIPT');
}));
test('staff role refusal and stale rate are surfaced without retrying writes',()=>fixture(async f=>{
 f.reply(async()=>Response.json({error:{code:'ROLE_REQUIRED'}},{status:403}));await assert.rejects(f.api.fare(),(e:unknown)=>e instanceof PlatformError&&e.code==='ROLE_REQUIRED');
 f.reply(async()=>Response.json({error:{code:'FARE_CHANGED'}},{status:409}));await assert.rejects(f.api.publish(command),(e:unknown)=>e instanceof PlatformError&&e.code==='FARE_CHANGED');assert.equal(f.calls.length,2);
}));
test('incident review checks matching receipt and unknown result is not retried',()=>fixture(async f=>{
 f.reply(async()=>Response.json(reviewed));assert.deepEqual(await f.api.review(id(5),review),reviewed);assert.equal(f.calls[0].path,'/api/mobile/v1/rides/incidents/'+id(5)+'/review');
 f.reply(async()=>Response.json({...reviewed,incidentId:id(6)}));await assert.rejects(f.api.review(id(5),review),(e:unknown)=>e instanceof PlatformError&&e.code==='INVALID_RECEIPT');
 f.reply(async()=>{throw Error('Response lost');});await assert.rejects(f.api.review(id(5),review),/Response lost/);assert.equal(f.calls.length,3);
}));
test('overlapping mutation is refused and logout fences in-flight sensitive response',()=>fixture(async f=>{
 let complete!:(response:Response)=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});f.reply(()=>{entered();return new Promise<Response>(r=>{complete=r;});});
 const pending=f.api.review(id(5),review);await started;await assert.rejects(f.api.publish(command),(e:unknown)=>e instanceof PlatformError&&e.code==='REQUEST_IN_PROGRESS');await f.api.logout();complete(Response.json(reviewed));await assert.rejects(pending,(e:unknown)=>e instanceof PlatformError&&e.code==='SESSION_CHANGED');assert.equal(f.calls.length,1);
}));
test('new login fences an old incident queue response',()=>fixture(async f=>{
 let complete!:(response:Response)=>void,entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});f.reply(()=>{entered();return new Promise<Response>(r=>{complete=r;});});
 const pending=f.api.incidents();await started;await f.api.verify('+66900000002','123456');complete(Response.json({incidents:[]}));await assert.rejects(pending,(e:unknown)=>e instanceof PlatformError&&e.code==='SESSION_CHANGED');
}));
