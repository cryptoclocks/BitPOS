import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {once,EventEmitter} from 'node:events';
import {WebSocket} from 'ws';
import type {CatalogPage,DeviceCommandResult,DeviceEvent,DeviceQuote} from '../packages/contracts/src/index';
import {promotionFixture} from './backend-promotions-fixture';
const enabled=process.env.BITPOS_BACKEND_INTEGRATION==='1';
// Opt-in loading boundary: never load private DB/runtime configuration for a skipped test.
after(async()=>{if(enabled){const {pool}=await import('../apps/api/src/db');await pool.end();}});
test('published daily catalog reaches production Mini consumer on reconnect and CART; expiry restores base without personal/global relabeling', {skip:!enabled,timeout:180000},async context=>{
 const binary=process.env.BITPOS_FIRMWARE_CATALOG_CONSUMER;
 assert.ok(binary,'Coordinator must build tools/firmware/ui-smoke.py --pickup-transport-output and set BITPOS_FIRMWARE_CATALOG_CONSUMER');
 const f=await promotionFixture();let socket:WebSocket|undefined,host:ChildProcessWithoutNullStreams|undefined;
 const traces:Record<string,unknown>[]=[];let failure:unknown,commands=Promise.resolve(),inputs=Promise.resolve();const observations=new EventEmitter();
 async function eventually(predicate:()=>boolean){while(!predicate()){if(failure)throw failure;await once(observations,'change',{signal:context.signal});}if(failure)throw failure;}
 function lastTrace(origin:string){for(let i=traces.length-1;i>=0;i--)if(traces[i].origin===origin)return traces[i];}
 function financial(){return lastTrace('production_consumer_host_adapter')!;}
 function catalogTrace(){return lastTrace('production_catalog_host_adapter')!;}
 let lastFrame:unknown=null;
 function input(value:unknown){const next=inputs.then(async()=>{assert.ok(host?.stdin);const frame=value as Record<string,unknown>;lastFrame={type:frame.type,host:frame.host,payload:frame.type==='CATALOG'?frame.payload:undefined};const before=traces.filter(t=>t.origin==='production_consumer_host_adapter').length;host.stdin.write(JSON.stringify(value)+'\n');await eventually(()=>traces.filter(t=>t.origin==='production_consumer_host_adapter').length>before);});inputs=next;return next;}
 async function receipt(value:DeviceCommandResult){await input({host:'expect_result',requestId:value.requestId});await input(value);assert.equal(financial().resync,false);}
 function catalogValue(value:DeviceCommandResult):CatalogPage {assert.ok(value.result.ok&&'catalog' in value.result.value);return value.result.value.catalog;}
 function quoteValue(value:DeviceCommandResult):DeviceQuote {assert.ok(value.result.ok&&'quote' in value.result.value);return value.result.value.quote;}
 async function readCatalog(){const value=await f.command(f.b.id,{type:'CATALOG_PAGE',menuVersion:null,pageIndex:0});await receipt(value);return catalogValue(value);}
 function expectDaily(catalog:CatalogPage,evidence:unknown){const row=catalog.products[0];assert.equal(row.productId,f.product);assert.equal(row.basePrice.amountMinor,'270');assert.equal(row.unitPrice.amountMinor,'230');assert.equal(row.promotion,null);assert.deepEqual(row.dailyPromotion,evidence);assert.equal(row.scopedPromotion,undefined);assert.ok(!('personalPromotion' in row));assert.equal(catalogTrace().daily_rows,1);assert.equal(catalogTrace().global_rows,0);assert.equal(catalogTrace().scoped_rows,0);assert.equal(catalogTrace().unit_minor,'230');assert.equal(catalogTrace().discount_minor,'40');}
 async function disconnect(){if(socket&&socket.readyState!==WebSocket.CLOSED){const closed=once(socket,'close');socket.close();await closed;}socket=undefined;}
 async function connect(){
  socket=new WebSocket(f.origin.replace('http:','ws:')+'/api/device',{headers:{Authorization:'Bearer '+f.credentials.get(f.b.id)}});
  let configuration:DeviceEvent|undefined,idleCatalog:DeviceEvent|undefined;
  socket.on('message',raw=>{const value=JSON.parse(raw.toString()) as DeviceEvent;if(value.type==='CONFIG')configuration=value;if(value.type==='CATALOG')idleCatalog=value;observations.emit('change');});
  socket.on('error',()=>{failure=Error('Fixture authenticated WebSocket failed');observations.emit('change');});
  await eventually(()=>!!configuration);
  const presence=(await f.inspect('SELECT connection_generation::text,connection_id FROM device_presence WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id])).rows[0];
  const actor=f.devices.get(f.b.id)!;actor.connectionGeneration=presence.connection_generation;actor.connectionId=presence.connection_id;
  await input(configuration);await eventually(()=>financial()?.synchronized===true&&financial()?.connection===actor.connectionGeneration);await commands;
  // The actual idle CATALOG event and explicit CATALOG_PAGE share catalogPage serialization.
  await eventually(()=>!!idleCatalog);await commands;await input(idleCatalog);await commands;
  assert.equal(financial().resync,false);assert.equal(catalogTrace().daily_rows,1);
  return actor.connectionGeneration;
 }
 try {
  const approved=await f.approve(await f.generate());await f.publish(approved);await f.reconcile();
  const evidence={campaignId:approved.id,campaignVersion:approved.version,discountPercent:15,startsAt:approved.startsAt,expiresAt:approved.expiresAt};
  host=spawn(binary,[f.b.id],{env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'},stdio:['pipe','pipe','pipe']});
  host.on('error',()=>{failure=Error('Production host binary failed to start');observations.emit('change');});host.on('exit',code=>{if(code!==0&&code!==null)failure=Error('Production host exited with code '+code);observations.emit('change');});
  createInterface({input:host.stderr}).on('line',line=>{if(line.startsWith('{')){const value=JSON.parse(line);traces.push(value);if(value.resync)failure=Error('Production consumer requested resync: '+JSON.stringify({trace:value,lastFrame}));observations.emit('change');}});
  createInterface({input:host.stdout}).on('line',line=>{if(!line.startsWith('{'))return;const value=JSON.parse(line);commands=commands.then(async()=>{const {schemaVersion,requestId,connectionGeneration,...body}=value;await input(await f.command(f.b.id,body,requestId));}).catch(error=>{failure=error;observations.emit('change');});});
  await eventually(()=>!!financial());
  const first=await connect(),initial=await readCatalog();expectDaily(initial,evidence);
  await disconnect();const second=await connect();assert.ok(BigInt(second)>BigInt(first));
  const reconnected=await readCatalog();expectDaily(reconnected,evidence);
  const before=financial().financial_digest,writes=catalogTrace().journal_writes;
  await input({host:'daily_catalog_guards',catalog:reconnected});
  const guards=lastTrace('production_daily_catalog_guards');assert.ok(guards);assert.equal(guards.financial_journal_unchanged,true);assert.equal(guards.cases,26);
  assert.equal(financial().financial_digest,before);assert.equal(catalogTrace().journal_writes,writes);
  // Another tenant cannot receive this campaign or product from the same serializer.
  // Intentional test module-loading boundary: static API import would require private config even when skipped.
  const {catalogPage}=await import('../apps/api/src/device-commands');
  const foreign=await f.tenant(f.other,db=>catalogPage(db,{...f.devices.get(f.b.id)!,merchant:f.other},null,0));assert.deepEqual(foreign.products,[]);assert.equal(foreign.priceVersion,null);
  const sessionId=randomUUID(),screen=(await f.inspect('SELECT s.screen_generation::text,d.assignment_generation::text FROM device_screen_state s JOIN devices d ON d.merchant_id=s.merchant_id AND d.id=s.device_id WHERE s.merchant_id=$1 AND s.device_id=$2',[f.merchant,f.b.id])).rows[0];
  const opened=await f.command(f.b.id,{type:'CART_OPEN',sessionId,expectedScreenGeneration:screen.screen_generation,expectedAssignmentGeneration:screen.assignment_generation,recoverSessionId:null});assert.equal(opened.result.ok,true);await receipt(opened);
  const cartCatalog=await readCatalog();expectDaily(cartCatalog,evidence);assert.equal(catalogTrace().observed_cart,true);assert.equal(catalogTrace().target,'');
  const set=await f.command(f.b.id,{type:'CART_SET',sessionId,expectedScreenGeneration:opened.screenGeneration,expectedAssignmentGeneration:opened.assignmentGeneration,expectedCartVersion:'0',items:[{productId:f.product,qty:2}]});assert.equal(set.result.ok,true);await receipt(set);
  assert.ok(cartCatalog.priceVersion);
  const reviewed=await f.command(f.b.id,{type:'CART_REVIEW',sessionId,expectedScreenGeneration:opened.screenGeneration,cartVersion:'1',expectedPriceVersion:cartCatalog.priceVersion});
  const quote=quoteValue(reviewed);assert.equal(quote.total.amountMinor,'460');
  // A server-local cart remains observed, never fabricated as editable local journal state.
  const submitted=await f.command(f.b.id,{type:'ORDER_SUBMIT',sessionId,expectedScreenGeneration:opened.screenGeneration,cartVersion:'1',quoteId:quote.quoteId,priceVersion:cartCatalog.priceVersion,idempotencyKey:randomUUID()});assert.equal(submitted.result.ok,true);await receipt(submitted);
  const page=await f.command(f.b.id,{type:'QUOTE_PAGE',quoteId:quote.quoteId,pageIndex:0});assert.equal(page.result.ok,true);await receipt(page);
  assert.equal(catalogTrace().review_minor,'460');assert.equal(catalogTrace().order_minor,'460');
  const frozen=(await f.inspect('SELECT lines FROM order_quotes WHERE merchant_id=$1 AND id=$2',[f.merchant,quote.quoteId])).rows[0].lines;assert.deepEqual(frozen[0].dailyPromotion,evidence);assert.equal(frozen[0].promotion,null);assert.equal(frozen[0].scopedPromotion,undefined);assert.equal(frozen[0].personalPromotion,undefined);
  // Disposable fixture clock only: no live provider, deployed DB, immutable bill, or physical device is changed.
  await f.inspect("UPDATE promotion_campaigns SET starts_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE merchant_id=$1 AND id=$2",[f.merchant,approved.id]);
  const stale=await f.command(f.b.id,{type:'CATALOG_PAGE',menuVersion:cartCatalog.menuVersion,pageIndex:0});assert.equal(stale.result.ok,false);if(!stale.result.ok)assert.equal(stale.result.error.code,'MENU_CHANGED');await receipt(stale);await commands;
  const expired=await readCatalog();assert.notEqual(expired.menuVersion,cartCatalog.menuVersion);assert.equal(expired.products[0].unitPrice.amountMinor,'270');assert.equal(expired.products[0].dailyPromotion,undefined);assert.equal(expired.products[0].promotion,null);assert.equal(catalogTrace().unit_minor,'270');assert.equal(catalogTrace().daily_rows,0);
  assert.deepEqual((await f.inspect('SELECT lines FROM order_quotes WHERE merchant_id=$1 AND id=$2',[f.merchant,quote.quoteId])).rows[0].lines,frozen);
  const finance=(await f.inspect('SELECT (SELECT count(*)::int FROM orders WHERE merchant_id=$1) AS orders,(SELECT reserved FROM products WHERE merchant_id=$1 AND id=$2) AS reserved',[f.merchant,f.product])).rows[0];assert.deepEqual(finance,{orders:1,reserved:2});
  await commands;await inputs;await disconnect();host.stdin.end();const [code]=await once(host,'exit');assert.equal(code,0);
 }finally{
  host?.kill();await disconnect();await f.close();
 }
});
