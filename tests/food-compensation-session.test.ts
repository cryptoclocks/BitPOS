import test from 'node:test';import assert from 'node:assert/strict';
import {FoodReturnSession} from '../apps/web/src/lib/food-return-session';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
for(const late of ['success','definite-refusal']as const)test(`late compensation ${late} cannot erase a newer unresolved case`,async()=>{
 const descriptors=['fetch','localStorage','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]as const),store=new Map<string,string>();let lock=Promise.resolve();const requests:Array<(r:Response)=>void>=[];
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(_k:string,fn:()=>unknown)=>{const next=lock.then(fn);lock=next.then(()=>{},()=>{});return next;}}}});
 globalThis.fetch=async(url)=>String(url).endsWith('/auth/verify')?Response.json({accountId:id(1),sessionId:id(2),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'}):new Promise<Response>(resolve=>requests.push(resolve));
 const command=(n:number)=>({caseId:id(n),command:{idempotencyKey:id(n+100),expectedVersion:'1',policyId:id(99),reason:'Synthetic canonical financial decision'}});
 const receipt=(n:number)=>Response.json({caseId:id(n),policyId:id(99),amountMinor:'100',currency:'USDG',decimals:6,state:'APPROVED',fundsTransferred:false});
 async function sent(n:number){for(let i=0;i<30&&requests.length<n;i++)await new Promise<void>(r=>setImmediate(r));assert.equal(requests.length,n);}
 try{
  const a=new FoodReturnSession(),b=new FoodReturnSession();await a.verify('+66900000002','123456');await b.verify('+66900000002','123456');
  const first=a.approveCompensation(command(3));await sent(1);const replay=b.approveCompensation(command(3));const replayResult=replay.catch(e=>e);await sent(2);
  await assert.rejects(b.approveCompensation(command(4)),/PENDING_COMMAND/);
  requests[0](receipt(3));await first;const next=a.approveCompensation(command(4));const nextResult=next.catch(e=>e);await sent(3);
  requests[1](late==='success'?receipt(3):Response.json({error:{code:'QUOTE_CHANGED'}},{status:409}));await replayResult;
  assert.deepEqual(a.pendingCompensation(),command(4));requests[2](Response.json({error:{code:'CONFIGURATION_REQUIRED'}},{status:503}));await nextResult;
  const reload=new FoodReturnSession();await reload.verify('+66900000002','123456');assert.deepEqual(reload.pendingCompensation(),command(4));assert.ok([...store.values()].every(v=>!v.includes('accessToken')));
 }finally{for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
