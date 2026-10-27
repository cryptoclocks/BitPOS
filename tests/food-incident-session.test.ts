import test from 'node:test';import assert from 'node:assert/strict';
import {FoodIncidentSession,type PendingFoodIncident} from '../apps/web/src/lib/food-incident-session';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
for(const kind of ['ACK','RESUME'] as const)for(const late of ['success','definitive-error'] as const)test(`late ${kind} ${late} in another tab cannot erase newer ambiguous command`,async()=>{
 const oldFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),navigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),values=new Map<string,string>();let lock=Promise.resolve();
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_name:string,callback:()=>unknown)=>{const next=lock.then(callback);lock=next.then(()=>{},()=>{});return next;}}}});
 const requests:Array<ReturnType<typeof deferred<Response>>>=[];
 globalThis.fetch=async(input)=>{if(String(input).endsWith('/auth/verify'))return Response.json({accountId:id(1),sessionId:id(2),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'});const pending=deferred<Response>();requests.push(pending);return pending.promise;};
 const command=(n:number):PendingFoodIncident=>kind==='ACK'?{kind,incidentId:id(3),command:{idempotencyKey:id(n),expectedVersion:'1',reason:'Synthetic ACK'}}:{kind,assignmentId:id(4),command:{idempotencyKey:id(n),expectedVersion:'1',generation:'1',leaseGeneration:'1',reason:'Synthetic resume'}};
 const response=()=>Response.json(kind==='ACK'?{incident:{incidentId:id(3),assignmentId:id(4),shipmentId:id(5),generation:'1',leaseGeneration:'1',incidentVersion:'2',kind:'SOS',custodyPhase:'AT_PICKUP',blocksDuty:true,reportedAt:'2026-10-18T00:00:00Z',acknowledgedAt:'2026-10-18T00:01:00Z',resolvedAt:null,resolution:null},shipmentVersion:'7',paused:true}:{assignmentId:id(4),shipmentId:id(5),generation:'1',leaseGeneration:'1',shipmentVersion:'8',state:'AT_PICKUP',resolvedCount:1});
 async function sent(n:number){for(let attempts=0;requests.length<n&&attempts<20;attempts++)await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(requests.length,n);}
 try{
  const a=new FoodIncidentSession(),b=new FoodIncidentSession();await a.verify('+66900000002','123456');await b.verify('+66900000002','123456');
  const first=a.submitIncident(command(10)),competing=b.submitIncident(command(12));
  await assert.rejects(competing,(error:unknown)=>error instanceof Error&&error.message==='PENDING_COMMAND');await sent(1);assert.deepEqual(a.pendingIncident(),command(10));
  const replay=b.submitIncident(command(10));const replayResult=replay.then(()=>null,e=>e);await sent(2);
  requests[0].resolve(response());await first;const newer=a.submitIncident(command(11));const newerResult=newer.then(()=>null,e=>e);await sent(3);
  requests[1].resolve(late==='success'?response():Response.json({error:{code:'VERSION_CONFLICT'}},{status:409}));await replayResult;
  assert.deepEqual(a.pendingIncident(),command(11),'Late old completion must not retire newer command');requests[2].resolve(Response.json({error:{code:'SERVICE_UNAVAILABLE'}},{status:503}));await newerResult;
  const reloaded=new FoodIncidentSession();await reloaded.verify('+66900000002','123456');assert.deepEqual(reloaded.pendingIncident(),command(11));
 }finally{globalThis.fetch=oldFetch;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');if(navigator)Object.defineProperty(globalThis,'navigator',navigator);else Reflect.deleteProperty(globalThis,'navigator');}
});
for(const sameAccount of [true,false])test(`queued staff intent cannot cross ${sameAccount?'same-account new session':'account switch'}`,async()=>{
 const oldFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),values=new Map<string,string>(),admitted=deferred<void>();let callback:(()=>unknown)|undefined,login=0,commands=0;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_name:string,action:()=>unknown)=>{callback=action;admitted.resolve();return Promise.resolve().then(async()=>{await released.promise;return action();});}}}});
 const released=deferred<void>();
 globalThis.fetch=async(input)=>{if(String(input).endsWith('/auth/verify')){login++;return Response.json({accountId:id(sameAccount?1:login),sessionId:id(100+login),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'});}commands++;throw Error('Stale queued intent must never reach network');};
 try{
  const api=new FoodIncidentSession();await api.verify('+66900000002','123456');
  const pending=api.acknowledgeIncident(id(3),{idempotencyKey:id(10),expectedVersion:'1',reason:'Synthetic old session intent'});const outcome=pending.then(()=>null,error=>error);
  await admitted.promise;assert.ok(callback);await api.verify('+66900000001','123456');released.resolve();const error=await outcome;
  assert.equal(error?.code,'SESSION_CHANGED');assert.equal(commands,0);assert.deepEqual([...values],[]);
 }finally{released.resolve();globalThis.fetch=oldFetch;if(storage)Object.defineProperty(globalThis,'localStorage',storage);else Reflect.deleteProperty(globalThis,'localStorage');if(nav)Object.defineProperty(globalThis,'navigator',nav);else Reflect.deleteProperty(globalThis,'navigator');}
});
