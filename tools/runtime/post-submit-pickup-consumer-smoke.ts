import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {AddressInfo} from 'node:net';
import fs from 'node:fs';
import {WebSocket} from 'ws';
import {tableFixture,staffToken} from '../../tests/backend-table-fixture';
import {server} from '../../apps/api/src/index';
import {pool} from '../../apps/api/src/db';

// Real API/WS + compiled production firmware consumer; synthetic tenant/payment
// and host display/NVS/audio adapters. Never physical, acoustic or chain proof.
const binary=process.argv[2];if(!binary||!fs.statSync(binary).isFile())throw Error('Compiled pickup consumer path required');
const fingerprint=()=>{const result=spawnSync('python3',['.omp/work/post-submit-20261012/gate.py','fingerprint'],{encoding:'utf8'});assert.equal(result.status,0,'source fingerprint command');return result.stdout.trim();};
const sourceFingerprint=fingerprint();
const executionSources=['tools/runtime/post-submit-pickup-consumer-smoke.ts','tools/firmware/pickup-transport.inc','device/firmware/main/bitpos_table_runtime.inc'].map(path=>({path,sha256:createHash('sha256').update(fs.readFileSync(path)).digest('hex')}));
server.listen(0,'127.0.0.1');await once(server,'listening');
const origin='http://127.0.0.1:'+(server.address() as AddressInfo).port;
async function until<T>(probe:()=>Promise<T>|T,predicate:(v:T)=>boolean,label:string){const deadline=Date.now()+15000;while(Date.now()<deadline){const value=await probe();if(predicate(value))return value;await delay(20);}throw Error('Timed out: '+label);}
const results:unknown[]=[];
try{
 for(const mode of ['fail_first_flush','fail_first_ack_enqueue']){
  const f=await tableFixture(),{order}=await f.create(await f.quote());
  const token=await staffToken(pool,f.merchant,f.actor,'staff');
  await f.tenant(f.merchant,async db=>{await db.query("UPDATE orders SET status='PAID',version=version+1 WHERE id=$1",[order.id]);await db.query("UPDATE device_screen_state SET kind='idle',order_id=NULL,screen_generation=screen_generation+1 WHERE device_id=$1",[f.a.id]);});
  async function api(path:string,body?:unknown){const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
  async function financial(){return f.tenant(f.merchant,async db=>({order:(await db.query('SELECT to_jsonb(o) AS value FROM orders o WHERE id=$1',[order.id])).rows[0].value,items:(await db.query('SELECT to_jsonb(i) AS value FROM order_items i WHERE order_id=$1 ORDER BY product_id',[order.id])).rows,stock:(await db.query('SELECT stock,reserved FROM products WHERE id=$1',[f.product])).rows}));}
  const before=await financial();
  const child=spawn(binary,[f.a.id],{env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'},stdio:['pipe','pipe','pipe']});
  const traces:any[]=[],commands:any[]=[],events:any[]=[],errors:string[]=[];let readyEvent:any,baseline:any;
  const socket=new WebSocket(origin.replace('http:','ws:')+'/api/device',{headers:{Authorization:'Bearer '+f.credentials.get(f.a.id)}});
  const control=(value:unknown)=>child.stdin.write(JSON.stringify(value)+'\n');
  createInterface({input:child.stderr}).on('line',line=>{try{const trace=JSON.parse(line);if(trace.origin==='production_consumer_host_adapter')traces.push(trace);else errors.push(line);}catch{errors.push(line);}});
  createInterface({input:child.stdout}).on('line',line=>{try{const command=JSON.parse(line);commands.push(command);if(socket.readyState===WebSocket.OPEN)socket.send(line);else errors.push('Command produced outside open socket');}catch{errors.push('Non-JSON firmware command');}});
  socket.on('message',raw=>{const event=JSON.parse(raw.toString());events.push(event);if(event.type==='PICKUP_READY'&&event.payload.state==='READY'&&!readyEvent){readyEvent=event;baseline=traces.at(-1);control({host:mode});}child.stdin.write(raw.toString()+'\n');});
  socket.on('error',error=>errors.push(error.message));child.on('error',error=>errors.push(error.message));
  try{
   await once(socket,'open');await until(()=>traces.at(-1),v=>!!v?.synchronized,'firmware authenticated session sync');
   await api('/api/orders/'+order.id+'/fulfillment',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()});
   await api('/api/orders/'+order.id+'/fulfillment',{status:'READY',expectedVersion:1,idempotencyKey:randomUUID()});
   const failed=await until(()=>traces.find(t=>readyEvent&&t.retry_event===readyEvent.eventId),v=>!!v,'original event retained after first failure');
   assert.equal(commands.some(c=>c.type==='ACK'&&c.eventId===readyEvent.eventId),false,'failure must not fabricate render receipt');
   assert.equal((await api('/api/orders/'+order.id)).fulfillment.notification.state,'DELIVERED');
   assert.equal(failed.claims,baseline.claims);assert.equal(failed.pickup_audio,baseline.pickup_audio);
   control({host:'tick',ms:1000});
   await until(()=>api('/api/orders/'+order.id),v=>v.fulfillment.notification.state==='RENDERED','original event rendered through real API ACK');
   await until(()=>traces.at(-1),v=>v?.pickup_active&&v.retry_event==='', 'correlated real ACK result consumed');
   const rendered=traces.at(-1);
   assert.equal(rendered.claims-baseline.claims,1);assert.equal(rendered.pickup_audio-baseline.pickup_audio,1);
   assert.equal(rendered.financial_digest,baseline.financial_digest);assert.equal(rendered.payment_audio,baseline.payment_audio);
   const readyEvents=events.filter(e=>e.type==='PICKUP_READY'&&e.payload.state==='READY');assert.equal(readyEvents.length,1,'no fabricated second server event or reconnect');
   const receipt=commands.find(c=>c.type==='ACK'&&c.eventId===readyEvent.eventId);assert.ok(receipt);assert.equal(receipt.deviceSeq,readyEvent.deviceSeq);assert.equal(receipt.connectionGeneration,readyEvent.connectionGeneration);
   control({host:'tick',ms:1000});control({host:'got_it'});
   await until(()=>api('/api/orders/'+order.id),v=>v.fulfillment.notification.state==='ACKNOWLEDGED','real LVGL Got it acknowledged');
   await until(()=>traces.at(-1),v=>v&&!v.pickup_active&&v.guest_request==='', 'guest result consumed');
   const done=traces.at(-1);assert.equal(done.pickup_audio,rendered.pickup_audio);assert.equal(done.claims,rendered.claims);assert.equal(done.financial_digest,baseline.financial_digest);
   assert.equal((await api('/api/orders/'+order.id)).fulfillment.status,'READY','guest acknowledgment is not collection');assert.deepEqual(await financial(),before);
   assert.deepEqual(errors,[]);assert.equal(done.resync,false);
   results.push({mode,orderId:order.id,eventId:readyEvent.eventId,effectId:readyEvent.payload.effectId,connectionGeneration:readyEvent.connectionGeneration,readyEvents:readyEvents.length,renderACK:receipt,failed,rendered,done,financialAndStockUnchanged:true});
  }finally{socket.terminate();child.stdin.end();child.kill();}
 }
 assert.equal(fingerprint(),sourceFingerprint,'source must remain frozen during joined proof');
 const evidence={scope:'post-submit-20261012',origin:'actual_local_HTTP_WebSocket_and_compiled_production_firmware_consumer',sourceFingerprint,executionSources,physical:false,chain:false,syntheticPaidFixture:true,at:new Date().toISOString(),results};
 fs.writeFileSync('.omp/work/post-submit-20261012/evidence/pickup-consumer-transport.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{server.close();await once(server,'close');await pool.end();}
