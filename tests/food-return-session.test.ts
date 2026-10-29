import test from 'node:test';import assert from 'node:assert/strict';
import {FoodReturnSession,type PendingFoodReturn} from '../apps/web/src/lib/food-return-session';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
for(const kind of ['REQUEST','RESOLVE'] as const)test(`${kind}: lost response survives reload; exact retry retires only matching receipt`,async()=>{
 const descriptors=['fetch','localStorage','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)] as const),values=new Map<string,string>();let calls=0,invalid=false;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_k:string,fn:()=>unknown)=>fn()}}});
 const input:PendingFoodReturn=kind==='REQUEST'?{kind,assignmentId:id(3),command:{idempotencyKey:id(4),expectedVersion:'1',generation:'1',leaseGeneration:'1',reason:'Return required'}}:{kind,assignmentId:id(3),caseId:id(5),command:{idempotencyKey:id(4),expectedVersion:'2',reason:'Merchant received food'}};
 const bodies:string[]=[];
 globalThis.fetch=async(url,options)=>{
  if(String(url).endsWith('/auth/verify'))return Response.json({accountId:id(1),sessionId:id(2),accessToken:'a'.repeat(43),refreshToken:'b'.repeat(43),accessExpiresAt:'2099-01-01T00:00:00Z',refreshExpiresAt:'2099-02-01T00:00:00Z'});
  bodies.push(String(options?.body));if(++calls===1)throw new TypeError('Response lost after commit');
  return Response.json(kind==='REQUEST'?{caseId:id(5),assignmentId:id(invalid?9:3),state:'RETURN_REQUESTED',custodyReleased:false,financialResolutionReady:false}:{caseId:id(invalid?9:5),assignmentId:id(3),state:'RETURN_RESOLVED',custodyReleased:true,financialReview:'PENDING',fundsTransferred:false,stockRestored:false});
 };
 try{
  const a=new FoodReturnSession();await a.verify('+66900000002','123456');await assert.rejects(a.submitReturn(input));assert.deepEqual(a.pendingReturn(),input);
  const b=new FoodReturnSession();await b.verify('+66900000002','123456');assert.deepEqual(b.pendingReturn(),input);
  await assert.rejects(b.submitReturn(input.kind==='REQUEST'?{...input,command:{...input.command,idempotencyKey:id(8)}}:{...input,command:{...input.command,idempotencyKey:id(8)}}),/PENDING_COMMAND/);assert.equal(calls,1);
  invalid=true;await assert.rejects(b.submitReturn(input),/INVALID_RECEIPT/);assert.deepEqual(b.pendingReturn(),input);
  invalid=false;await b.submitReturn(input);assert.equal(b.pendingReturn(),null);assert.equal(new Set(bodies).size,1);
 }finally{for(const [key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
