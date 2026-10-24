import test from 'node:test';
import assert from 'node:assert/strict';
import {finishGuestOrder,guestKey,priorPaidVisit} from '../apps/web/src/lib/table-guest';

const entry='table-entry',orderId='f11cb4b1-5022-4e4b-bf59-3c297d0572fe',newerId='f11cb4b1-5022-4e4b-bf59-3c297d0572ff';
const requestId='00000000-0000-4000-8000-000000000001',visitToken='a'.repeat(43);
const paid={id:orderId,status:'PAID' as const,tableOccupancyGeneration:'9007199254740993'};
const paidKey='bitpos-table-paid-visit-v1:'+entry;
const journal=(phase:string,id=orderId)=>JSON.stringify({phase,items:[{productId:requestId,qty:1}],requestId,visitToken,order:{id,status:'AWAITING_WALLET',tableOccupancyGeneration:'1'}});
function storage(run:(store:Map<string,string>,writes:string[])=>void){
 const store=new Map<string,string>(),writes:string[]=[];
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{writes.push(key);store.set(key,value);}}});
 try{run(store,writes);}finally{Reflect.deleteProperty(globalThis,'localStorage');}
}

test('verified paid Done preserves the original unpaid capability and server occupancy before clearing the cart',()=>storage((store,writes)=>{
 store.set(guestKey(entry),journal('order'));
 finishGuestOrder(entry,paid);
 assert.deepEqual(priorPaidVisit(entry),{visitToken,orderId,occupancyGeneration:paid.tableOccupancyGeneration});
 assert.deepEqual(writes,[paidKey,guestKey(entry)],'Retain the capability before discarding its original journal');
 const cleared=JSON.parse(store.get(guestKey(entry))!);
 assert.equal(cleared.phase,'draft');assert.deepEqual(cleared.items,[]);assert.notEqual(cleared.requestId,requestId);
 assert.equal(cleared.visitToken,undefined);assert.equal(cleared.order,undefined);
 const retained=store.get(paidKey);finishGuestOrder(entry,paid);
 assert.equal(store.get(paidKey),retained);assert.equal(writes.length,2,'Repeated Done does not replace the new draft');
}));

test('Done protects newer, unresolved and unverified journals and the existing paid source',()=>storage((store,writes)=>{
 const prior=JSON.stringify({visitToken:'b'.repeat(43),orderId:newerId,occupancyGeneration:'2'});store.set(paidKey,prior);
 for(const raw of [journal('order',newerId),journal('pending'),journal('review'),journal('draft')]){
  store.set(guestKey(entry),raw);finishGuestOrder(entry,paid);
  assert.equal(store.get(guestKey(entry)),raw);assert.equal(store.get(paidKey),prior);
 }
 const raw=journal('order');store.set(guestKey(entry),raw);
 for(const status of ['AWAITING_WALLET','CONFIRMING','EXPIRED','RECOVERY'] as const){
  finishGuestOrder(entry,{...paid,status});assert.equal(store.get(guestKey(entry)),raw);assert.equal(store.get(paidKey),prior);
 }
 store.delete(guestKey(entry));finishGuestOrder(entry,paid);
 assert.equal(store.has(guestKey(entry)),false);assert.deepEqual(writes,[]);
}));

test('failure retaining the paid capability leaves the originally unpaid journal intact',()=>storage((store)=>{
 const raw=journal('order');store.set(guestKey(entry),raw);
 Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:()=>{throw Error('Storage unavailable');}}});
 assert.throws(()=>finishGuestOrder(entry,paid),/Storage unavailable/);
 assert.equal(store.get(guestKey(entry)),raw);assert.equal(store.has(paidKey),false);
}));
