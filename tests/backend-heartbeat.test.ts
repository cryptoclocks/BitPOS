import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {tableFixture,success} from './backend-table-fixture';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('heartbeat renews only its live cart, never revives expired drafts, and preserves command conflict',integration,async()=>{
 const f=await tableFixture();const session=randomUUID();
 success(await f.command(f.b.id,{type:'CART_OPEN',sessionId:session,expectedScreenGeneration:'1',expectedAssignmentGeneration:'1',recoverSessionId:null}));
 const setRequest=randomUUID();success(await f.command(f.b.id,{type:'CART_SET',sessionId:session,expectedScreenGeneration:'2',expectedAssignmentGeneration:'1',expectedCartVersion:'0',items:[{productId:f.product,qty:2}]},setRequest));
 await f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET lease_until=clock_timestamp()+interval '30 seconds' WHERE device_id=$1",[f.b.id]));
 const before=(await f.tenant(f.merchant,db=>db.query('SELECT lease_until FROM device_screen_state WHERE device_id=$1',[f.b.id]))).rows[0].lease_until;
 const wrong=success(await f.command(f.b.id,{type:'HEARTBEAT',sessionId:randomUUID()}));assert.ok('screen' in wrong&&wrong.screen.kind==='cart');assert.equal(wrong.screen.sessionId,session);assert.equal(wrong.screen.leaseUntil,before.toISOString());
 const renewed=success(await f.command(f.b.id,{type:'HEARTBEAT',sessionId:session}));assert.ok('screen' in renewed&&renewed.screen.kind==='cart');assert.equal(renewed.screen.cartVersion,'1');assert.deepEqual(renewed.screen.items,[{productId:f.product,qty:2}]);assert.ok(Date.parse(renewed.screen.leaseUntil)>before.getTime()+60000);
 const priceVersion=(await f.tenant(f.merchant,db=>db.query('SELECT active_price_version_id FROM merchant_pricing WHERE merchant_id=$1',[f.merchant]))).rows[0].active_price_version_id;
 const review=success(await f.command(f.b.id,{type:'CART_REVIEW',sessionId:session,expectedScreenGeneration:'2',cartVersion:'1',expectedPriceVersion:priceVersion}));assert.ok('quote' in review);
 assert.equal(review.quote.total.amountMinor,'540');assert.equal(review.quote.settlement.amountMinor,'5400000');
 const quotedHeartbeat=success(await f.command(f.b.id,{type:'HEARTBEAT',sessionId:session}));assert.ok('screen' in quotedHeartbeat&&quotedHeartbeat.screen.kind==='cart');assert.deepEqual(quotedHeartbeat.screen.review,review.quote);
 const conflict=await f.command(f.b.id,{type:'HEARTBEAT',sessionId:session},setRequest);assert.ok(!conflict.result.ok);assert.equal(conflict.result.error.code,'COMMAND_CONFLICT');
 await f.tenant(f.merchant,db=>db.query("UPDATE device_screen_state SET lease_until=clock_timestamp()-interval '1 second' WHERE device_id=$1",[f.b.id]));
 const expired=success(await f.command(f.b.id,{type:'HEARTBEAT',sessionId:session}));assert.ok('screen' in expired);assert.deepEqual(expired.screen,{kind:'idle',screenGeneration:'3'});
 const saved=(await f.tenant(f.merchant,db=>db.query('SELECT cart,ended_at FROM device_sessions WHERE id=$1',[session]))).rows[0];assert.deepEqual(saved.cart,[{productId:f.product,qty:2}]);assert.ok(saved.ended_at);
 const idle=success(await f.command(f.b.id,{type:'HEARTBEAT',sessionId:session}));assert.ok('screen' in idle);assert.deepEqual(idle.screen,expired.screen);
});
test('heartbeat rejects forged, replaced, expired and cross-tenant actors without renewing presence',integration,async()=>{
 const f=await tableFixture();const {applyDeviceCommand,commandSchema}=await import('../apps/api/src/device-commands');const actor=f.devices.get(f.a.id);assert.ok(actor);
 const command=commandSchema.parse({schemaVersion:2,type:'HEARTBEAT',requestId:randomUUID(),connectionGeneration:actor.connectionGeneration,sessionId:null});
 const before=(await f.tenant(f.merchant,db=>db.query('SELECT connected_until,last_seen_at FROM device_presence WHERE device_id=$1',[f.a.id]))).rows[0];
 for(const forged of [{...actor,tokenHash:'0'.repeat(64)},{...actor,authGeneration:'999999'},{...actor,connectionId:randomUUID()},{...actor,connectionGeneration:'999999'},{...actor,merchant:f.other}])await assert.rejects(f.tenant(f.merchant,db=>applyDeviceCommand(db,forged,command,new Date().toISOString())),/DEVICE_AUTH_INVALID/);
 await assert.rejects(f.tenant(f.other,db=>applyDeviceCommand(db,actor,command,new Date().toISOString())),/DEVICE_AUTH_INVALID/);
 assert.deepEqual((await f.tenant(f.merchant,db=>db.query('SELECT connected_until,last_seen_at FROM device_presence WHERE device_id=$1',[f.a.id]))).rows[0],before);
 await f.tenant(f.merchant,db=>db.query("UPDATE device_presence SET connected_until=clock_timestamp()-interval '1 second' WHERE device_id=$1",[f.a.id]));
 await assert.rejects(f.command(f.a.id,{type:'HEARTBEAT',sessionId:null}),/DEVICE_AUTH_INVALID/);
 assert.ok((await f.tenant(f.merchant,db=>db.query('SELECT connected_until<clock_timestamp() AS expired FROM device_presence WHERE device_id=$1',[f.a.id]))).rows[0].expired);
});
test('internal heartbeat and screen data cannot be called by anonymous clients',integration,async()=>{
 const pg=await import('pg');const {config}=await import('../apps/api/src/config');
 const db=new pg.default.Client({connectionString:config.ADMIN_DATABASE_URL});await db.connect();
 try{await db.query('BEGIN');await db.query('SET LOCAL ROLE anon');
 for(const query of ['SELECT bitpos.device_current_screen_data(NULL::uuid,NULL::uuid)','SELECT bitpos.device_heartbeat(NULL::uuid,NULL::uuid,NULL::text,NULL::bigint,NULL::bigint,NULL::uuid,NULL::uuid,NULL::uuid)']){
 await db.query('SAVEPOINT anonymous_call');await assert.rejects(db.query(query),(error:{code?:string})=>error.code==='42501');await db.query('ROLLBACK TO SAVEPOINT anonymous_call');await db.query('RELEASE SAVEPOINT anonymous_call');
 }
 }finally{await db.query('ROLLBACK');await db.end();}
});
