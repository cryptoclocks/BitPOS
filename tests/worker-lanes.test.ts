import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {runWorkerLanes} from '../apps/worker/src/lanes';
function gate(){let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);return {pending,release};}
test('slow generation and failed financial dependency cannot block lifecycle or overlap ticks; shutdown drains all work',{timeout:5000},async t=>{
 const stop=new AbortController(),provider=gate(),entered=gate(),lifecycleAdvanced=gate();let active=0,calls=0,lifecycle=0,finished=false;
 const errors:string[]=[];t.mock.method(console,'error',(message:string)=>errors.push(message));
 const running=runWorkerLanes([
  {tick:async()=>{throw Error('controlled RPC unavailable');},unavailable:'financial state retained'},
  {tick:async()=>{lifecycle++;if(lifecycle===2)lifecycleAdvanced.release();},unavailable:'lifecycle state retained'},
  {tick:async()=>{calls++;active++;entered.release();await provider.pending;active--;},unavailable:'AI state retained'},
 ],stop.signal);
 try{
  await entered.pending;await lifecycleAdvanced.pending;
  assert.equal(active,1);assert.equal(calls,1,'timers must not launch overlapping AI jobs');assert.equal(lifecycle,2);
  assert.ok(errors.includes('financial state retained'),'failed lanes retain sanitized error observability');
  stop.abort();void running.then(()=>{finished=true;});await delay(10);assert.equal(finished,false,'pool owner must wait for in-flight job');
  provider.release();await running;assert.equal(active,0);assert.equal(calls,1);
  const lastLifecycle=lifecycle;await delay(10);assert.equal(lifecycle,lastLifecycle,'no lifecycle tick after stop');
 }finally{stop.abort();provider.release();await running;}
});
test('already stopped worker starts no lane',async()=>{
 const stop=new AbortController();stop.abort();let calls=0;
 await runWorkerLanes([{tick:async()=>{calls++;},unavailable:'state retained'}],stop.signal);assert.equal(calls,0);
});
