import test from 'node:test';
import assert from 'node:assert/strict';
import {createResilientFetch} from '../apps/api/src/rpc-resilience';

function harness(responses:Array<Response|Error>,options:Parameters<typeof createResilientFetch>[0]={}){
 let clock=1_000,calls=0;const sleeps:number[]=[],bodies:unknown[]=[];
 const fetchImpl=(async(_url:unknown,init?:RequestInit)=>{
  bodies.push(init?.body);const next=responses[Math.min(calls,responses.length-1)];calls+=1;
  if(next instanceof Error)throw next;return next.clone();
 })as typeof fetch;
 const run=createResilientFetch({fetchImpl,sleep:async ms=>{sleeps.push(ms);clock+=ms;},now:()=>clock,random:()=>1,minIntervalMs:0,...options});
 return {run,sleeps,bodies,calls:()=>calls};
}
const ok=()=>new Response('{"jsonrpc":"2.0","result":1,"id":1}',{status:200});
const limited=(retryAfter?:string)=>new Response('Too many requests',{status:429,headers:retryAfter?{'retry-after':retryAfter}:{}});

test('retries a rate limit with exponential backoff and returns the first good response',async()=>{
 const h=harness([limited(),limited(),ok()],{baseDelayMs:100,maxDelayMs:5000});
 const response=await h.run('https://rpc.test',{method:'POST',body:'{"id":1}'});
 assert.equal(response.status,200);assert.equal(h.calls(),3);assert.deepEqual(h.sleeps,[100,200]);
 assert.deepEqual(h.bodies,['{"id":1}','{"id":1}','{"id":1}'],'the request body is replayed byte for byte');
});

test('honours Retry-After when it is longer than the backoff, capped by the maximum delay',async()=>{
 const h=harness([limited('2'),limited('60'),ok()],{baseDelayMs:100,maxDelayMs:3000,deadlineMs:60_000});
 await h.run('https://rpc.test',{method:'POST',body:'x'});
 assert.deepEqual(h.sleeps,[2000,3000]);
});

test('returns the last 429 unchanged once the retry budget is spent',async()=>{
 const h=harness([limited()],{maxRetries:2,baseDelayMs:10});
 const response=await h.run('https://rpc.test',{method:'POST',body:'x'});
 assert.equal(response.status,429);assert.equal(h.calls(),3);
});

test('does not retry client errors or successes',async()=>{
 const bad=harness([new Response('bad',{status:400})]);
 assert.equal((await bad.run('https://rpc.test',{method:'POST',body:'x'})).status,400);assert.equal(bad.calls(),1);
 const fine=harness([ok()]);await fine.run('https://rpc.test',{method:'POST',body:'x'});assert.equal(fine.calls(),1);
});

test('retries a network failure and rethrows it when the budget is spent',async()=>{
 const recovers=harness([new TypeError('fetch failed'),ok()],{baseDelayMs:10});
 assert.equal((await recovers.run('https://rpc.test',{method:'POST',body:'x'})).status,200);assert.equal(recovers.calls(),2);
 const down=harness([new TypeError('fetch failed')],{maxRetries:1,baseDelayMs:10});
 await assert.rejects(down.run('https://rpc.test',{method:'POST',body:'x'}),/fetch failed/);assert.equal(down.calls(),2);
});

test('stops retrying when the total deadline would be exceeded',async()=>{
 const h=harness([limited('10')],{maxRetries:5,maxDelayMs:10_000,deadlineMs:5_000});
 const response=await h.run('https://rpc.test',{method:'POST',body:'x'});
 assert.equal(response.status,429);assert.equal(h.calls(),1);assert.deepEqual(h.sleeps,[]);
});

test('a caller abort is never retried',async()=>{
 const controller=new AbortController(),h=harness([limited()],{baseDelayMs:10});
 controller.abort(new Error('caller gave up'));
 await assert.rejects(h.run('https://rpc.test',{method:'POST',body:'x',signal:controller.signal}),/caller gave up/);
 assert.equal(h.calls(),0);
});

test('paces request starts by the minimum interval',async()=>{
 const h=harness([ok()],{minIntervalMs:150});
 await Promise.all([1,2,3].map(()=>h.run('https://rpc.test',{method:'POST',body:'x'})));
 assert.equal(h.calls(),3);
 assert.ok(h.sleeps.length>=2,'later starts wait for the pacing gap');
 assert.ok(h.sleeps.every(ms=>ms>0&&ms<=300));
});

test('caps requests in flight',async()=>{
 let active=0,peak=0;const release:Array<()=>void>=[];
 const fetchImpl=(async()=>{active+=1;peak=Math.max(peak,active);await new Promise<void>(resolve=>release.push(resolve));active-=1;return ok();})as typeof fetch;
 const run=createResilientFetch({fetchImpl,maxConcurrent:2,minIntervalMs:0,sleep:async()=>{}});
 const all=Promise.all([1,2,3,4].map(()=>run('https://rpc.test',{method:'POST',body:'x'})));
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(peak,2);
 while(release.length){release.shift()!();await new Promise(resolve=>setImmediate(resolve));}
 await all;assert.equal(peak,2);
});
