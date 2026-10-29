import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import net from 'node:net';
import type pg from 'pg';
process.env.DOTENV_CONFIG_PATH='/dev/null';
process.env.ADMIN_DATABASE_URL='postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
Object.assign(process.env,{DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets',BITPOS_MOBILE_ENABLED:'1'});
const {pool}=await import('../apps/api/src/db');
const {attachFoodRealtime,foodRealtime}=await import('../apps/api/src/food-realtime');
const flush=async()=>{await new Promise<void>(resolve=>setImmediate(resolve));};
class Client extends EventEmitter {
 released=0;
 query: (text:string)=>Promise<unknown>=async()=>({rows:[]});
 release(){this.released++;assert.equal(this.released,1,'client released exactly once');}
}
for(const failure of ['error-with-query-rejection','query-rejection','error-after-listen']){
 test(`listener recovers after ${failure} without double release`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const first=new Client(),next=new Client();let connections=0,reject:((reason:Error)=>void)|undefined;
  first.query=()=>failure==='error-after-listen'?Promise.resolve({rows:[]}):new Promise((_,fail)=>reject=fail);
  t.mock.method(pool,'connect',async()=>{connections++;return (connections===1?first:next) as unknown as pg.PoolClient;});
  const server=http.createServer();attachFoodRealtime(server);server.emit('listening');await flush();
  if(failure!=='query-rejection')first.emit('error',Error('synthetic listener disconnect'));
  reject?.(Error('synthetic pending LISTEN rejection'));await flush();
  assert.equal(first.released,1);assert.equal(connections,1);
  t.mock.timers.tick(5000);await flush();assert.equal(connections,2);
  server.emit('close');assert.equal(next.released,1);
  t.mock.timers.tick(10000);await flush();assert.equal(connections,2);
 });
}
const id='00000000-0000-4000-8000-000000000001';
function fakeResponse(req:http.IncomingMessage,accept=true,completeEnd=true){
 const res=new http.ServerResponse(req);let destroyed=false;const frames:string[]=[];
 res.write=((chunk:unknown)=>{frames.push(String(chunk));return accept;}) as typeof res.write;
 res.end=(()=>{if(completeEnd)res.emit('close');return res;}) as typeof res.end;
 res.destroy=(()=>{destroyed=true;res.emit('close');return res;}) as typeof res.destroy;
 return {res,frames,get destroyed(){return destroyed;}};
}
function request(){const req=new http.IncomingMessage(new net.Socket());req.url=`/api/mobile/v1/food/orders/${id}/delivery/events`;req.method='GET';req.headers.authorization='Bearer '+ 'a'.repeat(43);return req;}
for(const accept of [true,false]){
 test(accept?'initial read coalesces wake hints and reconciles dirty state':'backpressure destroys transport before freeing stream admission',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const listener=new Client();let reads=0,active=0,maximum=0,release:(()=>void)|undefined;
  const held=new Promise<void>(resolve=>release=resolve);
  t.mock.method(pool,'query',async()=>({rows:[{account_id:id,session_id:id,device_id:id}]}));
  let connections=0;
  t.mock.method(pool,'connect',async()=>{
   if(connections++===0)return listener as unknown as pg.PoolClient;
   const client=new Client();client.query=async text=>{
    if(!text.includes('dispatch_customer_realtime'))return {rows:[]};
    reads++;active++;maximum=Math.max(maximum,active);if(reads===1)await held;active--;
    return {rows:[{value:{serverTime:'2026-10-18T00:00:00Z',work:{shipmentId:id,state:'READY_FOR_DISPATCH',version:'1',generation:'0',assignment:null,dispatch:{phase:'NEEDS_ATTENTION',attentionReason:null,search:null,reassignment:null}}}}]};
   };return client as unknown as pg.PoolClient;
  });
  const server=http.createServer();attachFoodRealtime(server);server.emit('listening');await flush();
  const req=request(),response=fakeResponse(req,accept),pending=foodRealtime(req,response.res);await flush();
  listener.emit('notification');listener.emit('notification');await flush();assert.equal(reads,1);assert.equal(maximum,1);
  release!();await pending;
  if(accept){t.mock.timers.tick(300);await flush();assert.equal(reads,2);assert.equal(maximum,1);assert.ok(response.frames.some(frame=>frame.includes('event: snapshot')));response.res.emit('close');}
  else{assert.equal(response.destroyed,true);t.mock.timers.tick(2000);await flush();assert.equal(reads,1);}
  server.emit('close');req.destroy();
 });
}

for(const terminal of ['lifetime','read-failure']){
 test(`stalled graceful ${terminal} remains counted until bounded forced close`,async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  let fail=false;
  t.mock.method(pool,'query',async()=>({rows:[{account_id:id,session_id:id,device_id:id}]}));
  t.mock.method(pool,'connect',async()=>{const db=new Client();db.query=async text=>{
   if(!text.includes('dispatch_customer_realtime'))return {rows:[]};
   if(fail)throw Error('synthetic authorized read failure');
   return {rows:[{value:{serverTime:'2026-10-18T00:00:00Z',work:{shipmentId:id,state:'READY_FOR_DISPATCH',version:'1',generation:'0',assignment:null,dispatch:{phase:'NEEDS_ATTENTION',attentionReason:null,search:null,reassignment:null}}}}]};
  };return db as unknown as pg.PoolClient;});
  const streams=[];for(let n=0;n<3;n++){const req=request(),response=fakeResponse(req,true,false);streams.push({req,response});await foodRealtime(req,response.res);}
  if(terminal==='lifetime'){t.mock.timers.tick(120000);await flush();}
  else{fail=true;t.mock.timers.tick(1000);await flush();t.mock.timers.tick(250);await flush();}
  assert.ok(streams.every(stream=>stream.response.frames.some(frame=>frame.includes('event: clear'))));
  const heldReq=request(),heldResponse=fakeResponse(heldReq);await foodRealtime(heldReq,heldResponse.res);assert.equal(heldResponse.res.statusCode,429);heldReq.destroy();
  t.mock.timers.tick(250);await flush();
  // A true write/end is not closure: the transport must eventually be destroyed.
  assert.ok(streams.every(stream=>stream.response.destroyed));
  fail=false;const req=request(),response=fakeResponse(req);await foodRealtime(req,response.res);assert.equal(response.res.statusCode,200);
  response.res.emit('close');req.destroy();for(const stream of streams)stream.req.destroy();
 });
}
test('cancel during initial authentication never acquires admission or reads a projection',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});let resolve:((result:unknown)=>void)|undefined,reads=0;
 let calls=0;t.mock.method(pool,'query',()=>calls++===0?new Promise(done=>resolve=done):Promise.resolve({rows:[{account_id:id,session_id:id,device_id:id}]}));
 t.mock.method(pool,'connect',async()=>{reads++;throw Error('dead transport must not reach projection');});
 const req=request(),response=fakeResponse(req),pending=foodRealtime(req,response.res);
 response.res.emit('close');resolve!({rows:[{account_id:id,session_id:id,device_id:id}]});await pending;
 t.mock.timers.tick(10000);await flush();assert.equal(reads,0);
 req.destroy();
});

test('chat stream emits only authorized sequence hints and clears after authority refusal',async t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval']});
 let latest='1',refused=false,reads=0;
 t.mock.method(pool,'query',async()=>({rows:[{account_id:id,session_id:id,device_id:id}]}));
 t.mock.method(pool,'connect',async()=>{
  const client=new Client();client.query=async text=>{
   if(!text.includes('food_chat103_signal'))return {rows:[]};
   reads++;if(refused)throw Error('CHAT_UNAVAILABLE');
   return {rows:[{value:{assignmentId:id,latestSequence:latest,peerReadSequence:'0',serverTime:'2026-10-20T01:00:00Z'}}]};
  };return client as unknown as pg.PoolClient;
 });
 const req=request();req.url=`/api/mobile/v1/food/assignments/${id}/chat/events`;
 const response=fakeResponse(req);await foodRealtime(req,response.res);
 assert.equal(response.res.statusCode,200);assert.equal(reads,1);
 const first=response.frames.find(frame=>frame.includes('event: snapshot'))!;
 const data=JSON.parse(first.split('data: ')[1].split('\n')[0]);
 assert.deepEqual(Object.keys(data).sort(),['assignmentId','cursor','latestSequence','peerReadSequence','serverTime']);
 assert.equal(data.latestSequence,'1');assert.match(data.cursor,/^f1_[A-Za-z0-9_-]{43}$/);
 latest='2';t.mock.timers.tick(1000);await flush();t.mock.timers.tick(250);await flush();
 assert.ok(response.frames.some(frame=>frame.includes('"latestSequence":"2"')));
 refused=true;t.mock.timers.tick(1000);await flush();t.mock.timers.tick(250);await flush();
 assert.ok(response.frames.some(frame=>frame.includes('event: clear')));
 const closed=request();closed.url=req.url;const closedResponse=fakeResponse(closed);await foodRealtime(closed,closedResponse.res);
 assert.equal(closedResponse.res.statusCode,404);assert.equal(closedResponse.frames.length,0);
 response.res.emit('close');closedResponse.res.emit('close');req.destroy();closed.destroy();
});
