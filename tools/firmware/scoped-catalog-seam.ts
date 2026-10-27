// Opt-in integration proof: real API/DB catalog and receipts -> compiled production consumer.
// AI provider is explicitly the existing fixture; no chain payment, deploy or hardware write.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import type {DeviceCommandResult,DeviceEvent} from '../../packages/contracts/src/index';
import {promotionFixture} from '../../tests/backend-promotions-fixture';

assert.equal(process.env.BITPOS_BACKEND_INTEGRATION,'1','Requires coordinator-authorized disposable backend integration database');
const binary=process.argv[2];assert.ok(binary,'Pass compiled --pickup-transport-output binary');
const f=await promotionFixture();let socket:WebSocket|undefined,host:ChildProcessWithoutNullStreams|undefined;
const traces:Record<string,unknown>[]=[];let failure:unknown;let lane=Promise.resolve();
function eventually(predicate:()=>boolean){return new Promise<void>((resolve,reject)=>{const end=Date.now()+15000;const timer=setInterval(()=>{if(failure||Date.now()>end){clearInterval(timer);reject(failure??Error('Timed out awaiting sanitized consumer observation'));}else if(predicate()){clearInterval(timer);resolve();}},10);});}
async function input(value:unknown){assert.ok(host?.stdin);const before=traces.filter(t=>t.origin==='production_consumer_host_adapter').length;host.stdin.write(JSON.stringify(value)+'\n');await eventually(()=>traces.filter(t=>t.origin==='production_consumer_host_adapter').length>before);}
async function receipt(value:DeviceCommandResult){await input({host:'expect_result',requestId:value.requestId});await input(value);assert.equal(traces.at(-1)?.resync,false);}
function catalogTrace(){return traces.findLast(t=>t.origin==='production_catalog_host_adapter')!;}
function financialTrace(){return traces.findLast(t=>t.origin==='production_consumer_host_adapter')!;}
try {
 const sent=await f.publish(await f.approve(await f.generate()));await f.reconcile();
 socket=new WebSocket(f.origin.replace('http:','ws:')+'/api/device',{headers:{Authorization:'Bearer '+f.credentials.get(f.b.id)}});
 const configPromise=new Promise<DeviceEvent>((resolve,reject)=>{socket!.on('message',raw=>{const event=JSON.parse(raw.toString());if(event.type==='CONFIG')resolve(event);});socket!.once('error',()=>reject(Error('Fixture authenticated WebSocket failed')));});
 const config=await configPromise;
 const presence=(await f.inspect('SELECT connection_generation::text,connection_id FROM device_presence WHERE merchant_id=$1 AND device_id=$2',[f.merchant,f.b.id])).rows[0];
 const actor=f.devices.get(f.b.id)!;actor.connectionGeneration=presence.connection_generation;actor.connectionId=presence.connection_id;
 host=spawn(binary,[f.b.id],{env:{...process.env,ASAN_OPTIONS:'detect_leaks=0'},stdio:['pipe','pipe','pipe']});
 host.on('error',()=>{failure=Error('Production host binary failed to start');});host.on('exit',code=>{if(code!==0&&code!==null)failure=Error('Production host exited with code '+code);});
 createInterface({input:host.stderr!}).on('line',line=>{if(line.startsWith('{')){const value=JSON.parse(line);traces.push(value);if(value.resync)failure=Error('Production consumer requested resync');}});
 createInterface({input:host.stdout!}).on('line',line=>{if(!line.startsWith('{'))return;const command=JSON.parse(line);lane=lane.then(async()=>{const {schemaVersion,requestId,connectionGeneration,...body}=command;const response=await f.command(f.b.id,body,requestId);await input(response);}).catch(error=>{failure=error;});});
 await eventually(()=>!!financialTrace());
 await input(config);await eventually(()=>financialTrace()?.synchronized===true);await lane;
 const offerToken=new URL(sent.target.menuUrl).searchParams.get('offer')!,sessionId=randomUUID();
 const opened=await f.command(f.b.id,{type:'CART_OPEN',sessionId,expectedScreenGeneration:sent.target.screenGeneration,expectedAssignmentGeneration:sent.target.assignmentGeneration,recoverSessionId:null,offerToken});assert.equal(opened.result.ok,true);await receipt(opened);
 const before=financialTrace(),writesBefore=catalogTrace().journal_writes,catalog=await f.command(f.b.id,{type:'CATALOG_PAGE',menuVersion:null,pageIndex:0});assert.ok(catalog.result.ok&&'catalog' in catalog.result.value);
 await receipt(catalog);const observed=catalogTrace();assert.equal(observed.unit_minor,'230');assert.equal(observed.scoped_rows,1);assert.equal(observed.session,sessionId);assert.equal(observed.target,sent.target.id);assert.equal(observed.observed_cart,true);assert.equal(observed.cart_owner,false);assert.equal(financialTrace().financial_digest,before.financial_digest);assert.equal(observed.journal_writes,writesBefore);
 if(!catalog.result.ok||!('catalog' in catalog.result.value))throw Error('Missing actual scoped catalog');
 await input({host:'catalog_guards',catalog:catalog.result.value.catalog});assert.equal(traces.findLast(t=>t.origin==='production_scoped_catalog_guards')?.financial_journal_unchanged,true);
 const generation=opened.screenGeneration;
 const setBody={type:'CART_SET',sessionId,expectedScreenGeneration:generation,expectedAssignmentGeneration:sent.target.assignmentGeneration,expectedCartVersion:'0'};
 const qty=await f.command(f.b.id,{...setBody,items:[{productId:f.product,qty:2}]});assert.equal(qty.result.ok,true);
 const limited=await f.command(f.b.id,{type:'CART_REVIEW',sessionId,expectedScreenGeneration:generation,cartVersion:'1',expectedPriceVersion:sent.campaign.priceVersion});assert.equal(limited.result.ok,false);if(!limited.result.ok)assert.equal(limited.result.error.code,'PROMOTION_LIMIT_EXCEEDED');
 const set=await f.command(f.b.id,{...setBody,expectedCartVersion:'1',items:[{productId:f.product,qty:1}]});assert.equal(set.result.ok,true);await receipt(set);
 const reviewed=await f.command(f.b.id,{type:'CART_REVIEW',sessionId,expectedScreenGeneration:generation,cartVersion:'2',expectedPriceVersion:sent.campaign.priceVersion});assert.ok(reviewed.result.ok&&'quote' in reviewed.result.value);
 if(!reviewed.result.ok||!('quote' in reviewed.result.value))throw Error('Missing actual quote');assert.equal(reviewed.result.value.quote.total.amountMinor,'230');
 // Observer invariant: a server-local cart does not become editable local journal state.
 // Feed the frozen order then actual QUOTE_PAGE; this is the production observer bill path.
 const order=await f.command(f.b.id,{type:'ORDER_SUBMIT',sessionId,expectedScreenGeneration:generation,cartVersion:'2',quoteId:reviewed.result.value.quote.quoteId,priceVersion:sent.campaign.priceVersion,idempotencyKey:randomUUID()});assert.equal(order.result.ok,true);await receipt(order);
 const page=await f.command(f.b.id,{type:'QUOTE_PAGE',quoteId:reviewed.result.value.quote.quoteId,pageIndex:0});assert.equal(page.result.ok,true);await receipt(page);
 assert.equal(catalogTrace().review_minor,'230');assert.equal(catalogTrace().order_minor,'230');assert.equal(catalogTrace().journal_writes,writesBefore);
 const counter=await f.quote();assert.equal(counter.total.amountMinor,'270');assert.equal(counter.lines[0].scopedPromotion,undefined);
 const other=await f.command(f.c.id,{type:'CART_OPEN',sessionId:randomUUID(),expectedScreenGeneration:'1',expectedAssignmentGeneration:'1',recoverSessionId:null,offerToken});assert.equal(other.result.ok,false);
 host.stdin!.end();const [code]=await once(host,'exit');assert.equal(code,0);
 console.log(JSON.stringify({origin:'actual_server_scoped_catalog_to_compiled_production_consumer',provider:'fixture_provider_not_real_AI',catalog_minor:observed.unit_minor,session_matches:true,target_matches:true,one_item_limit:true,unrelated_counter_minor:counter.total.amountMinor,actual_frozen_order_and_quote_page_minor:catalogTrace().order_minor,guard_cases:traces.findLast(t=>t.origin==='production_scoped_catalog_guards')?.cases,financial_journal_unchanged:true,physical_proof:false}));
} finally {
 host?.kill();if(socket&&socket.readyState!==WebSocket.CLOSED){socket.close();await once(socket,'close');}
 await f.close();
 // Intentional opt-in loading boundary: private DB configuration is not imported before authorization.
 const {pool}=await import('../../apps/api/src/db');await pool.end();
}
