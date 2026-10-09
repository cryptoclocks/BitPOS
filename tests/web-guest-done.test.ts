import test from 'node:test';import assert from 'node:assert/strict';
import {finishGuestOrder,guestKey} from '../apps/web/src/lib/table-guest';
test('verified Done clears only the matching completed guest order, retaining a newer or unresolved visit',()=>{
 const store=new Map<string,string>();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>store.set(key,value)}});
 const entry='table-entry';const saved=(phase:string,id:string)=>JSON.stringify({phase,items:[],requestId:'f11cb4b1-5022-4e4b-bf59-3c297d0572fe',order:{id}});
 try{const newer=saved('order','newer');store.set(guestKey(entry),newer);finishGuestOrder(entry,'old');assert.equal(store.get(guestKey(entry)),newer);
 const pending=saved('pending','old');store.set(guestKey(entry),pending);finishGuestOrder(entry,'old');assert.equal(store.get(guestKey(entry)),pending);
 store.set(guestKey(entry),saved('order','old'));finishGuestOrder(entry,'old');const cleared=JSON.parse(store.get(guestKey(entry))!);assert.equal(cleared.phase,'draft');assert.equal(cleared.visitToken,undefined);assert.equal(cleared.order,undefined);
 }finally{Reflect.deleteProperty(globalThis,'localStorage');}
});
