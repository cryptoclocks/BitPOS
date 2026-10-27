import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {once,EventEmitter} from 'node:events';
import {WebSocket} from 'ws';
import type {DeviceCommandResult,DeviceEvent,PriceConfiguration} from '../packages/contracts/src/index';
import type {DevicePromotionPlaylist} from '../packages/contracts/src/daily-promotions';
import {promotionFixture} from './backend-promotions-fixture';
const enabled=process.env.BITPOS_BACKEND_INTEGRATION==='1';
// The skipped test must not load private backend configuration.
after(async()=>{if(enabled){const {pool}=await import('../apps/api/src/db');await pool.end();}});
test('authenticated USDG playlist and attached reconnect snapshots reach the production Mini consumer without currency substitution; expiry restores base', {skip:!enabled,timeout:180000},async context=>{
 const binary=process.env.BITPOS_FIRMWARE_CATALOG_CONSUMER;
 assert.ok(binary,'Build tools/firmware/ui-smoke.py --pickup-transport-output and set BITPOS_FIRMWARE_CATALOG_CONSUMER');
 const f=await promotionFixture();let socket:WebSocket|undefined,host:ChildProcessWithoutNullStreams|undefined;
 const observations=new EventEmitter(),traces:Record<string,unknown>[]=[];
 type Frame=DeviceEvent|DeviceCommandResult;
 const applied:{frame:Frame;promotion:Record<string,unknown>}[]=[],sent:Record<string,unknown>[]=[];
 const closing=new WeakSet<WebSocket>();let failure:unknown,inputs=Promise.resolve();
 function fail(error:unknown){failure=error;observations.emit('change');}
 async function eventually(predicate:()=>boolean){while(!predicate()){if(failure)throw failure;await once(observations,'change',{signal:context.signal});}if(failure)throw failure;}
 function last(origin:string){for(let i=traces.length-1;i>=0;i--)if(traces[i].origin===origin)return traces[i];return undefined;}
 function financial(){return last('production_consumer_host_adapter')!;}
 function promotion(){return last('production_promotion_host_adapter')!;}
 function input(value:unknown){const next=inputs.then(async()=>{assert.ok(host?.stdin);const before=traces.filter(t=>t.origin==='production_consumer_host_adapter').length;host.stdin.write(JSON.stringify(value)+'\n');await eventually(()=>traces.filter(t=>t.origin==='production_consumer_host_adapter').length>before);});inputs=next;return next;}
 function playlist(frame:Frame):DevicePromotionPlaylist|undefined {
  if(frame.type==='COMMAND_RESULT')return undefined;
  if(frame.type==='PROMOTION_PLAYLIST')return frame.payload;
  if(frame.type==='CONFIG'||frame.type==='SNAPSHOT')return frame.payload.promotionPlaylist;
  return undefined;
 }
 function received(type:Frame['type'],connection:string,predicate:(frame:Frame)=>boolean=()=>true){return applied.find(entry=>entry.frame.type===type&&entry.frame.connectionGeneration===connection&&predicate(entry.frame));}
 async function disconnect(){if(socket&&socket.readyState!==WebSocket.CLOSED){closing.add(socket);const closed=once(socket,'close');socket.close();await closed;}socket=undefined;await inputs;}
 async function connect(){
  const before=applied.length,ws=new WebSocket(f.origin.replace('http:','ws:')+'/api/device',{headers:{Authorization:'Bearer '+f.credentials.get(f.b.id)}});socket=ws;
  ws.on('error',()=>fail(Error('Authenticated fixture WebSocket failed')));
  ws.on('close',()=>{if(!closing.has(ws))fail(Error('Authenticated fixture WebSocket closed unexpectedly'));});
  ws.on('message',raw=>{
   const frame=JSON.parse(raw.toString()) as Frame;
   // Forward every actual backend frame intact, including CONFIG/SNAPSHOT/ACK results.
   void input(frame).then(()=>{applied.push({frame,promotion:{...promotion()}});observations.emit('change');}).catch(fail);
  });
  await eventually(()=>applied.slice(before).some(entry=>entry.frame.type==='CONFIG'));
  const config=applied.slice(before).find(entry=>entry.frame.type==='CONFIG')!.frame;
  const connection=config.connectionGeneration;
  await eventually(()=>!!received('SNAPSHOT',connection)&&financial().synchronized===true&&financial().connection===connection);
  const presence=(await f.inspect('SELECT connection_id FROM device_presence WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id])).rows[0];
  const actor=f.devices.get(f.b.id)!;actor.connectionGeneration=connection;actor.connectionId=presence.connection_id;
  return connection;
 }
 async function catalog(connection:string){
  const requestId=randomUUID();await input({host:'expect_result',requestId});assert.equal(socket?.readyState,WebSocket.OPEN);
  socket!.send(JSON.stringify({schemaVersion:2,type:'CATALOG_PAGE',connectionGeneration:connection,requestId,menuVersion:null,pageIndex:0}));
  await eventually(()=>!!received('COMMAND_RESULT',connection,frame=>frame.type==='COMMAND_RESULT'&&frame.requestId===requestId));
  const frame=received('COMMAND_RESULT',connection,value=>value.type==='COMMAND_RESULT'&&value.requestId===requestId)!.frame as DeviceCommandResult;
  assert.ok(frame.result.ok&&'catalog' in frame.result.value);return frame.result.value.catalog;
 }
 function expectPromotion(value:Record<string,unknown>,campaign:string){
  assert.equal(value.authorized,true);assert.equal(value.count,1);assert.equal(value.active,true);
  assert.equal(value.campaign,campaign);assert.equal(value.currency,'USDG');assert.equal(value.decimals,6);
  assert.equal(value.base_minor,'2700000');assert.equal(value.unit_minor,'2295000');assert.equal(value.price,'USDG 2.295000');
 }
 function expectVisiblePromotion(value:Record<string,unknown>,campaign:string){
  expectPromotion(value,campaign);assert.equal(value.visible,true);assert.equal(value.price_label_visible,true);
 }
 try {
  // Intentional opt-in module-loading boundary: static API import would require private configuration even when skipped.
  // Republish only this disposable tenant through the production price authority.
  const {publishPrices}=await import('../apps/api/src/catalog');
  const configuration:PriceConfiguration={...f.configuration,expectedRevision:f.pricing.revision,catalogCurrency:'USDG',prices:[{productId:f.product,unitMinor:'2700000'}],settlement:{...f.configuration.settlement,quotePolicy:'USDG_RAW_IDENTITY'}};
  await f.tenant(f.merchant,db=>publishPrices(db,f.merchant,f.actor,'owner',configuration));
  host=spawn(binary,[f.b.id],{env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'},stdio:['pipe','pipe','pipe']});
  host.on('error',()=>fail(Error('Production consumer host failed to start')));host.on('exit',code=>{if(code!==0&&code!==null)fail(Error('Production consumer host exited with code '+code));});
  createInterface({input:host.stderr}).on('line',line=>{if(line.startsWith('{')){const value=JSON.parse(line);traces.push(value);if(value.resync)fail(Error('Production consumer rejected an authenticated USDG frame'));observations.emit('change');}});
  createInterface({input:host.stdout}).on('line',line=>{if(!line.startsWith('{'))return;const value=JSON.parse(line) as Record<string,unknown>;sent.push(value);if(socket?.readyState!==WebSocket.OPEN){fail(Error('Host command has no authenticated socket'));return;}socket.send(line);observations.emit('change');});
  await eventually(()=>!!financial());const first=await connect();
  const approved=await f.approve(await f.generate({minimumUnitMinor:'1000000'}));await f.publish(approved);await f.reconcile();
  const activeFrame=(frame:Frame)=>playlist(frame)?.items.some(item=>item.campaignId===approved.id)===true;
  await eventually(()=>!!received('PROMOTION_PLAYLIST',first,activeFrame));
  const live=received('PROMOTION_PLAYLIST',first,activeFrame)!;expectVisiblePromotion(live.promotion,approved.id);
  const livePlaylist=playlist(live.frame)!;assert.deepEqual(livePlaylist.items[0].basePrice,{currency:'USDG',decimals:6,amountMinor:'2700000'});
  assert.deepEqual(livePlaylist.items[0].unitPrice,{currency:'USDG',decimals:6,amountMinor:'2295000'});assert.equal(livePlaylist.items[0].discountPercent,15);
  const before=financial().financial_digest,writes=last('production_catalog_host_adapter')!.journal_writes;
  await input({host:'promotion_currency_guards',playlist:livePlaylist});
  const guards=last('production_promotion_currency_guards');assert.ok(guards);assert.equal(guards.cases,18);assert.equal(guards.financial_journal_unchanged,true);
  assert.equal(financial().financial_digest,before);assert.equal(last('production_catalog_host_adapter')!.journal_writes,writes);
  const frozenQuote=await f.quote(),frozen=(await f.inspect('SELECT lines FROM order_quotes WHERE merchant_id=$1 AND id=$2',[f.merchant,frozenQuote.id])).rows[0].lines;
  assert.deepEqual(frozenQuote.total,{currency:'USDG',decimals:6,amountMinor:'2295000'});
  await disconnect();const second=await connect();assert.ok(BigInt(second)>BigInt(first));
  for(const type of ['CONFIG','SNAPSHOT'] as const){const attached=received(type,second,activeFrame);assert.ok(attached,'Reconnect must attach the active USDG campaign to '+type);expectPromotion(attached.promotion,approved.id);assert.deepEqual(playlist(attached.frame)!.items,livePlaylist.items);}
  // CONFIG and SNAPSHOT install the active playlist before SESSION_SYNC authorizes idle rendering.
  // connect() waits for that real correlated response; assert the actual resulting LVGL scene separately.
  expectVisiblePromotion(promotion(),approved.id);
  const discounted=await catalog(second);assert.deepEqual(discounted.products[0].unitPrice,{currency:'USDG',decimals:6,amountMinor:'2295000'});assert.equal(discounted.products[0].dailyPromotion?.campaignId,approved.id);
  assert.ok(sent.some(value=>value.type==='SESSION_SYNC'&&value.connectionGeneration===second),'Production reconnect must synchronize over the authenticated socket');
  // Expire only the disposable fixture campaign; do not touch immutable quotes or a live provider/device.
  await f.inspect("UPDATE promotion_campaigns SET starts_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND id=$2",[f.merchant,approved.id]);await f.reconcile();
  const expiredFrame=(frame:Frame)=>{const value=playlist(frame);return !!value&&value.items.length===0&&BigInt(value.generation)>BigInt(livePlaylist.generation);};
  await eventually(()=>!!received('PROMOTION_PLAYLIST',second,expiredFrame));
  const expired=received('PROMOTION_PLAYLIST',second,expiredFrame)!;assert.equal(expired.promotion.count,0);assert.equal(expired.promotion.active,false);assert.equal(expired.promotion.visible,false);assert.equal(expired.promotion.price_label_visible,false);
  assert.ok(expired.frame.type==='PROMOTION_PLAYLIST');const expiredEventId=expired.frame.eventId;
  await eventually(()=>sent.some(value=>value.type==='ACK'&&value.eventId===expiredEventId&&value.connectionGeneration===second));
  const expiredAck=sent.find(value=>value.type==='ACK'&&value.eventId===expiredEventId&&value.connectionGeneration===second)!;
  await eventually(()=>!!received('COMMAND_RESULT',second,frame=>frame.type==='COMMAND_RESULT'&&frame.requestId===expiredAck.requestId));
  const ackResult=received('COMMAND_RESULT',second,frame=>frame.type==='COMMAND_RESULT'&&frame.requestId===expiredAck.requestId)!.frame as DeviceCommandResult;
  assert.ok(ackResult.result.ok&&'acknowledged' in ackResult.result.value&&ackResult.result.value.acknowledged);
  const base=await catalog(second);assert.deepEqual(base.products[0].unitPrice,{currency:'USDG',decimals:6,amountMinor:'2700000'});assert.equal(base.products[0].dailyPromotion,undefined);assert.notEqual(base.menuVersion,discounted.menuVersion);
  await disconnect();const third=await connect();assert.ok(BigInt(third)>BigInt(second));
  for(const type of ['CONFIG','SNAPSHOT'] as const){const attached=received(type,third,expiredFrame);assert.ok(attached);assert.equal(attached.promotion.count,0);assert.equal(attached.promotion.active,false);assert.equal(attached.promotion.visible,false);}
  assert.deepEqual((await f.inspect('SELECT lines FROM order_quotes WHERE merchant_id=$1 AND id=$2',[f.merchant,frozenQuote.id])).rows[0].lines,frozen);
  const finance=(await f.inspect('SELECT (SELECT count(*)::int FROM orders WHERE merchant_id=$1) AS orders,(SELECT count(*)::int FROM payments WHERE merchant_id=$1) AS payments,(SELECT reserved FROM products WHERE merchant_id=$1 AND id=$2) AS reserved,(SELECT stock FROM products WHERE merchant_id=$1 AND id=$2) AS stock',[f.merchant,f.product])).rows[0];assert.deepEqual(finance,{orders:0,payments:0,reserved:0,stock:20});
  assert.equal(financial().resync,false);assert.equal(financial().payment_audio,0);assert.equal(financial().pickup_audio,0);
  await disconnect();host.stdin.end();const [code]=await once(host,'exit');assert.equal(code,0);
 }finally{host?.kill();await disconnect();await f.close();}
});
