import test from 'node:test';import assert from 'node:assert/strict';
import {MerchantFoodReturn} from '../apps/web/src/lib/merchant-food-return';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
test('merchant return response loss, owner separation and receipt identity retain exact journal',async()=>{
 const descriptors=['fetch','localStorage','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]as const),store=new Map<string,string>();let calls=0,wrong=false,active=true;
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v),removeItem:(k:string)=>store.delete(k)}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_k:string,fn:()=>unknown)=>fn()}}});
 const session={token:'private-test-token',merchantId:id(1),userId:id(2),role:'owner'},command={assignmentId:id(3),caseId:id(4),command:{idempotencyKey:id(5),expectedVersion:'2',condition:'DAMAGED' as const,reason:'Synthetic received food'}};
 const bodies:string[]=[];
 globalThis.fetch=async(_url,options)=>{bodies.push(String(options?.body));if(++calls===1)throw new TypeError('Lost response');return Response.json({caseId:id(wrong?9:4),assignmentId:id(3),state:'RETURN_RECORDED',custodyReleased:false,financialResolutionReady:false});};
 try{
  const first=new MerchantFoodReturn(session,id(6),()=>active);await assert.rejects(first.receive(command));assert.deepEqual(first.pending(),command);
  const reload=new MerchantFoodReturn(session,id(6),()=>active);assert.deepEqual(reload.pending(),command);
  assert.equal(new MerchantFoodReturn({...session,userId:id(8)},id(6),()=>true).pending(),null);
  assert.equal(new MerchantFoodReturn({...session,merchantId:id(8)},id(6),()=>true).pending(),null);
  await assert.rejects(reload.receive({...command,command:{...command.command,idempotencyKey:id(7)}}),/PENDING_COMMAND/);assert.equal(calls,1);
  wrong=true;await assert.rejects(reload.receive(command),/INVALID_RECEIPT/);assert.deepEqual(reload.pending(),command);
  active=false;await assert.rejects(reload.receive(command),/SESSION_CHANGED/);assert.equal(calls,2);
  active=true;wrong=false;await reload.receive(command);assert.equal(reload.pending(),null);assert.equal(new Set(bodies).size,1);assert.ok([...store.values()].every(v=>!v.includes(session.token)));
 }finally{for(const[key,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}}
});
