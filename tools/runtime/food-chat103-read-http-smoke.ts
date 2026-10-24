import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {writeFile} from 'node:fs/promises';import type pg from 'pg';import {FoodChatReadReceiptSchema,FoodChatRealtimeSnapshotSchema,FoodChatMessageSchema} from '../../packages/contracts/src/mobile-v1.generated';import {openEvents} from './food-chat102-http-smoke';
type Actor={account:string;access:string};type Context={db:pg.Client;base:string;assignmentId:string;customer:Actor;driverActor:Actor;outsider:Actor};
async function call(c:Context,actor:Actor,suffix:string,method:string,body?:unknown,status=200){const response=await fetch(c.base+'/api/mobile/v1/food/assignments/'+c.assignmentId+'/chat'+suffix,{method,headers:{Authorization:'Bearer '+actor.access,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)}),value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
export async function verifyChat103ReadHttp(c:Context){
 const one=FoodChatMessageSchema.parse(await call(c,c.customer,'','POST',{commandId:randomUUID(),body:'Synthetic103 customer first'}));
 const two=FoodChatMessageSchema.parse(await call(c,c.driverActor,'','POST',{commandId:randomUUID(),body:'Synthetic103 rider second'}));
 const three=FoodChatMessageSchema.parse(await call(c,c.customer,'','POST',{commandId:randomUUID(),body:'Synthetic103 customer third'}));
 const events=await openEvents(c,c.customer);
 try{
  const initial=FoodChatRealtimeSnapshotSchema.parse((await events.frame()).data);assert.equal(initial.peerReadSequence,'0');
  const results=await Promise.all(Array.from({length:12},async(_,n)=>{
   const body={lastReadSequence:n%2?one.sequence:three.sequence};
   for(let attempt=0;attempt<50;attempt++){
    const response=await fetch(c.base+'/api/mobile/v1/food/assignments/'+c.assignmentId+'/chat/read',{method:'PUT',headers:{Authorization:'Bearer '+c.driverActor.access,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)}),value=await response.json();
    if(response.status===200)return FoodChatReadReceiptSchema.parse(value);
    assert.equal(response.status,409,JSON.stringify(value));assert.equal(value.error.code,'CHAT_RETRY');await new Promise(resolve=>setTimeout(resolve,20));
   }throw Error('Read retry budget exhausted');
  }));assert.ok(results.every(r=>BigInt(r.lastReadSequence)>=BigInt(one.sequence)));
  const high=FoodChatReadReceiptSchema.parse(await call(c,c.driverActor,'/read','PUT',{lastReadSequence:three.sequence}));assert.equal(high.lastReadSequence,three.sequence);
  const lower=FoodChatReadReceiptSchema.parse(await call(c,c.driverActor,'/read','PUT',{lastReadSequence:one.sequence}));assert.deepEqual(lower,high);
  let observed=false;for(let n=0;n<6;n++){const event=await events.frame();assert.equal(event.event,'snapshot');const signal=FoodChatRealtimeSnapshotSchema.parse(event.data);if(signal.peerReadSequence===three.sequence){assert.notEqual(signal.cursor,initial.cursor);assert.equal(signal.latestSequence,initial.latestSequence);observed=true;break;}}assert.ok(observed);
 }finally{await events.close();}
 await call(c,c.customer,'/read','PUT',{lastReadSequence:one.sequence},422);await call(c,c.customer,'/read','PUT',{lastReadSequence:'0'},422);await call(c,c.outsider,'/read','PUT',{lastReadSequence:one.sequence},404);await call(c,c.driverActor,'/read?x=1','PUT',{lastReadSequence:one.sequence},422);
 await call(c,c.customer,'/read','PUT',{lastReadSequence:two.sequence});
 const driverEvents=await openEvents(c,c.driverActor);try{assert.equal(FoodChatRealtimeSnapshotSchema.parse((await driverEvents.frame()).data).peerReadSequence,two.sequence);}finally{await driverEvents.close();}
 const state=(await c.db.query('SELECT account_id,last_sequence::text FROM bitpos.food_chat103_read_cursors WHERE assignment_id=$1',[c.assignmentId])).rows;assert.equal(state.length,2);assert.equal(state.find(r=>r.account_id===c.driverActor.account).last_sequence,three.sequence);assert.equal(state.find(r=>r.account_id===c.customer.account).last_sequence,two.sequence);
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/food-chat103-read-actual-http-20261020.json',JSON.stringify({status:'PASS_ACTUAL_HTTP_CHAT_READ_CURSOR_AND_PEER_SSE',checks:['12 concurrent mixed lower/higher read acknowledgements converge to maximum','Lower/replayed read returns same receipt and original maximum timestamp','Peer-read-only change changes signed SSE cursor even without new message','Each actor sees counterpart cursor, never infers read from delivery','Own-message/zero/outsider/query injection refused; two persisted cursor rows match actual API'],limits:['Local canonical synthetic paid/assigned job; no human-eye or device rendering claim from HTTP','Native visible acknowledgement acceptance tracked separately']},null,2)+'\n');console.log('PASS_ACTUAL_HTTP_CHAT_READ_CURSOR_AND_PEER_SSE');
}
export async function verifyChat103Closed(c:Context){await call(c,c.customer,'/read','PUT',{lastReadSequence:'2'},409);console.log('PASS_ACTUAL_HTTP_CLOSED_CHAT_READ_REFUSED');}
