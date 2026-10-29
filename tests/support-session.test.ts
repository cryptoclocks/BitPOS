import test from 'node:test';import assert from 'node:assert/strict';import {SupportSession} from '../apps/web/src/lib/support-session';import {PlatformError} from '../apps/web/src/lib/platform-session';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const command={commandId:id(3),expectedVersion:'2',action:'REPLY' as const,message:'Answer',reason:'Resolve question'};
const receipt={id:id(4),subject:'Help',state:'OPEN',createdAt:'2026-10-19T00:00:00Z',order:null,version:'3'};
async function fixture(action:(f:{api:SupportSession;values:Map<string,string>;calls:string[];reply:(fn:()=>Promise<Response>)=>void;fresh:()=>Promise<SupportSession>})=>Promise<void>){
 const oldFetch=globalThis.fetch,storage=Object.getOwnPropertyDescriptor(globalThis,'localStorage'),nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),values=new Map<string,string>(),calls:string[]=[],locks=new Map<string,Promise<unknown>>();let reply=async()=>Response.json(receipt);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:(key:string,action:()=>unknown)=>{const next=(locks.get(key)??Promise.resolve()).then(action);locks.set(key,next.catch(()=>{}));return next;}}}});
 globalThis.fetch=async(input,init)=>{const path=String(input);if(path.endsWith('/auth/verify'))return Response.json({accountId:id(1),sessionId:id(2),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'});if(path.endsWith('/auth/logout'))return Response.json({revoked:true});calls.push(String(init?.body));return reply();};
 const fresh=async()=>{const api=new SupportSession();await api.verify('+66900000001','123456');return api;};
 try{await action({api:await fresh(),fresh,values,calls,reply:fn=>{reply=fn;}});}finally{globalThis.fetch=oldFetch;for(const [key,descriptor]of[['localStorage',storage],['navigator',nav]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
}
test('ambiguous support reply survives reload, blocks replacement and replays original command',()=>fixture(async f=>{
 f.reply(async()=>{throw Error('Lost response after commit');});await assert.rejects(f.api.command(id(4),command));const next=await f.fresh();assert.deepEqual(next.pendingSupport(),{caseId:id(4),command});await assert.rejects(next.command(id(4),{...command,commandId:id(5)}),(e:unknown)=>e instanceof PlatformError&&e.code==='PENDING_COMMAND');assert.equal(f.calls.length,1);
 f.reply(async()=>Response.json(receipt));await next.command(id(4),next.pendingSupport()!.command);assert.equal(next.pendingSupport(),null);assert.deepEqual(f.calls.map(x=>JSON.parse(x).commandId),[id(3),id(3)]);
}));
test('wrong case receipt retains journal; definite stale rejection clears it',()=>fixture(async f=>{
 f.reply(async()=>Response.json({...receipt,id:id(8)}));await assert.rejects(f.api.command(id(4),command));assert.ok(f.api.pendingSupport());f.reply(async()=>Response.json({error:{code:'VERSION_CONFLICT'}},{status:409}));await assert.rejects(f.api.command(id(4),command));assert.equal(f.api.pendingSupport(),null);
}));
test('logout during reply hides result and retains exact recovery command',()=>fixture(async f=>{
 let resolve!:(value:Response)=>void;f.reply(()=>new Promise(r=>{resolve=r;}));const running=f.api.command(id(4),command);while(!resolve)await new Promise(r=>setTimeout(r,0));await f.api.logout();resolve(Response.json(receipt));await assert.rejects(running,(e:unknown)=>e instanceof PlatformError&&e.code==='SESSION_CHANGED');const next=await f.fresh();assert.deepEqual(next.pendingSupport(),{caseId:id(4),command});
}));

test('transient authority lock retry retains original support journal',()=>fixture(async f=>{
 f.reply(async()=>Response.json({error:{code:'DISPATCH_AUTH_RETRY'}},{status:409}));await assert.rejects(f.api.command(id(4),command));assert.deepEqual(f.api.pendingSupport(),{caseId:id(4),command});
}));
