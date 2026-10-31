import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {foodSmokeMigration} from './food-smoke-schema';
process.env.DOTENV_CONFIG_PATH='/dev/null';
const fixtureDatabase=process.argv.includes('--issuer-expiry')?process.env.BITPOS_DISPATCH_EXPIRY_DATABASE??'bitpos_dispatch_expiry_fixture':'bitpos_delivery_fixture';
if(process.argv.includes('--issuer-expiry')&&!/^bitpos_dispatch_expiry_fixture(?:_[0-9]+)?$/.test(fixtureDatabase))throw Error('Expiry smoke requires its dedicated local disposable database');
const ownFixture=process.argv.includes('--own-fixture');
const joinedRace=process.argv.includes('--race-food')?'food':process.argv.includes('--race-ride')?'ride':null;
const draftRace=process.argv.includes('--race-draft');
const batchRace=process.argv.includes('--race-batch')?'batch':process.argv.includes('--race-batch-ride')?'ride':null;
const batchOfferRace=process.argv.includes('--race-batch-offer')?'batch':process.argv.includes('--race-offer-batch')?'offer':null;
const batchReplayRace=process.argv.includes('--race-batch-replay');
if(batchReplayRace&&(!ownFixture||!process.argv.includes('--dispatch')||joinedRace||draftRace||batchRace||batchOfferRace))throw Error('Batch replay race requires --dispatch --own-fixture and no other race');
if(batchOfferRace&&(!ownFixture||!process.argv.includes('--dispatch')||joinedRace||draftRace||batchRace))throw Error('Batch offer race requires --dispatch --own-fixture and no other race');
if(batchRace&&(!ownFixture||!process.argv.includes('--dispatch')||joinedRace||draftRace))throw Error('Batch race requires --dispatch --own-fixture and no other race');
if(draftRace&&(!ownFixture||!process.argv.includes('--dispatch')||joinedRace))throw Error('Draft race requires --dispatch --own-fixture and no other race');
if(joinedRace&&(!ownFixture||!process.argv.includes('--dispatch')))throw Error('Race requires --dispatch --own-fixture');
if(ownFixture&&process.argv.includes('--issuer-expiry'))throw Error('Own fixture cannot run the issuer-expiry variant');
const fixturePort=ownFixture?55440:55436;
Object.assign(process.env,{DATABASE_URL:`postgresql://bitpos_app@127.0.0.1:${fixturePort}/${fixtureDatabase}`,ADMIN_DATABASE_URL:`postgresql://cryptoclock@127.0.0.1:${fixturePort}/${fixtureDatabase}`,AUTH_URL:'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {captureQuote,publishPrices,validateQuote}=await import('../../apps/api/src/catalog');
const {createQuotedOrder,orderView,orderViews}=await import('../../apps/api/src/orders');
const {pool}=await import('../../apps/api/src/db');
const {MINT,TOKEN_PROGRAM,hash}=await import('../../packages/domain/src/index');
const {FoodDriverWorkSchema,FoodMerchantWorkSchema}=await import('../../packages/contracts/src/mobile-v1.generated');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const merchant=randomUUID(),account=randomUUID(),branch=randomUUID(),product=randomUUID(),policy=randomUUID(),address=randomUUID();
const passed:string[]=[];
try{
 await db.query('BEGIN');if(!(await db.query("SELECT to_regclass('bitpos.quote_delivery_snapshots') AS installed")).rows[0].installed)await db.query(await readFile('supabase/migrations/060_food_delivery_snapshots.sql','utf8'));
 await db.query('SET LOCAL search_path=bitpos,public');
 await db.query("SELECT set_config('bitpos.merchant',$1,true),set_config('bitpos.mobile_account',$2,true)",[merchant,account]);
 await db.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'DELIVERY060 ROLLBACK FIXTURE','11111111111111111111111111111111')",[merchant]);
 await db.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
 await db.query("INSERT INTO marketplace_branches(merchant_id,id,name,enabled,delivery_enabled) VALUES($1,$2,'FIXTURE',true,true)",[merchant,branch]);
 await db.query("INSERT INTO mobile_addresses(id,account_id,label,recipient_name,phone,address_text,instructions,latitude_e7,longitude_e7) VALUES($1,$2,'Fixture','Fixture recipient','+66900000001','Synthetic destination','',137560001,1005018001)",[address,account]);
 await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'ทดสอบ','Fixture food','',270,5)",[product,merchant]);
 const client=db as unknown as pg.PoolClient;
 await publishPrices(client,merchant,account,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'ROLLBACK FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 const price=(await db.query('SELECT active_price_version_id FROM merchant_pricing WHERE merchant_id=$1',[merchant])).rows[0].active_price_version_id;
 await db.query("INSERT INTO delivery_policy_versions(merchant_id,branch_id,id,price_version_id,currency,decimals,name,origin_latitude_e7,origin_longitude_e7,south_e7,north_e7,west_e7,east_e7,delivery_minor,service_minor,merchant_minor,driver_minor,platform_minor,published_by,fixture) VALUES($1,$2,$3,$4,'USD',2,'FIXTURE',137560000,1005018000,137000000,138000000,1004000000,1006000000,100,20,0,100,20,$5,true)",[merchant,branch,policy,price,account]);
 await db.query('INSERT INTO branch_delivery_policies VALUES($1,$2,1,$3,true)',[merchant,branch,policy]);
 const customer=(await db.query('INSERT INTO customers(merchant_id) VALUES($1) RETURNING id',[merchant])).rows[0].id;
 await db.query('INSERT INTO mobile_customer_links VALUES($1,$2,$3)',[account,merchant,customer]);
 const origin={kind:'online' as const,id:account,branchId:branch},items=[{lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}],authority={kind:'versioned' as const,source:{kind:'online' as const,accountId:account,branchId:branch,channel:'customer_app' as const,label:'Fixture'},serving:{kind:'delivery' as const,label:'Fixture delivery'},target:null,pairingGeneration:null};
 await db.query('SET LOCAL ROLE bitpos_app');
 async function denied(name:string,code:string,action:()=>Promise<unknown>,message?:string){await db.query('SAVEPOINT delivery_negative');let actual:unknown,actualMessage:unknown;try{await action();await db.query('SET CONSTRAINTS ALL IMMEDIATE');}catch(error){actual=(error as {code?:string}).code;actualMessage=(error as {message?:string}).message;}finally{await db.query('ROLLBACK TO SAVEPOINT delivery_negative');await db.query('RELEASE SAVEPOINT delivery_negative');}assert.equal(actual,code,name);if(message!==undefined)assert.equal(actualMessage,message,name+' reason');passed.push(name);}
 await denied('Wrong account cannot read owned destination','42501',()=>captureQuote(client,merchant,{...origin,id:randomUUID()},items,authority,customer,{addressId:address,addressVersion:'1',policyVersionId:policy}));
 await denied('Stale address version denied','SERVING_UNAVAILABLE',()=>captureQuote(client,merchant,origin,items,authority,customer,{addressId:address,addressVersion:'2',policyVersionId:policy}));
 await denied('Unpublished policy denied','SERVING_UNAVAILABLE',()=>captureQuote(client,merchant,origin,items,authority,customer,{addressId:address,addressVersion:'1',policyVersionId:randomUUID()}));
 await denied('Address version above bigint maximum is a client error','INVALID_REQUEST',()=>captureQuote(client,merchant,origin,items,authority,customer,{addressId:address,addressVersion:'9223372036854775808',policyVersionId:policy}));
 await denied('Maximum bigint version remains a valid stale-version input','SERVING_UNAVAILABLE',()=>captureQuote(client,merchant,origin,items,authority,customer,{addressId:address,addressVersion:'9223372036854775807',policyVersionId:policy}));
 const q=await captureQuote(client,merchant,origin,items,authority,customer,{addressId:address,addressVersion:'1',policyVersionId:policy});
 assert.equal(q.total_minor,'390');await validateQuote(client,merchant,q);passed.push('Server-owned destination/policy adds exact 120 minor fees to 270 food');
 await denied('Frozen delivery destination cannot be edited','42501',()=>db.query("UPDATE quote_delivery_snapshots SET address_text='tampered' WHERE merchant_id=$1 AND quote_id=$2",[merchant,q.id]));
 const order=await createQuotedOrder(client,merchant,{quote:q,customerId:customer,idempotencyKey:randomUUID(),requestHash:'fixture-only',screenGeneration:null});
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 const shipment=(await db.query('SELECT state,account_id,quote_id FROM food_shipments WHERE merchant_id=$1 AND order_id=$2',[merchant,order.id])).rows;
 assert.deepEqual(shipment,[{state:'WAITING_MERCHANT',account_id:account,quote_id:q.id}]);passed.push('Actual canonical factory creates immutable linked shipment without register/device');
 assert.notEqual(order.status,'PAID');passed.push('Delivery admission does not confirm payment');
 if(process.argv.includes('--dispatch')){
  await db.query('RESET ROLE');
  assert.ok((await db.query("SELECT to_regprocedure('bitpos.food_driver_authority(uuid,uuid)') installed")).rows[0].installed,'Dispatch smoke requires current cumulative078 fixture schema; never replace active functions with061/065 definitions');
  if(!ownFixture)await foodSmokeMigration(db,'078_food_driver_authority.sql',"to_regprocedure('bitpos.food_driver_authority(uuid,uuid)')");
  const {fixturePaymentAttempt}=await import('../../tests/backend-payment-fixture');
  const {settleAttempt}=await import('../../apps/api/src/orders');
  const {decideOnlineOrder}=await import('../../apps/api/src/mobile-food');
  const driverAccount=randomUUID(),driverId=randomUUID(),dispatcherSession=randomUUID(),driverSession=randomUUID(),grant=randomUUID();
  await db.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[driverAccount,randomUUID()]);
  for(const [id,owner] of [[dispatcherSession,account],[driverSession,driverAccount]])await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,encode(sha256($4::bytea),'hex'),encode(sha256($5::bytea),'hex'),clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[id,owner,randomUUID(),randomUUID(),randomUUID()]);
  await db.query("INSERT INTO platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,'dispatcher','Local synthetic fixture',clock_timestamp()+interval '1 hour')",[grant,account]);
  await db.query('INSERT INTO platform_role_scopes VALUES($1,$2)',[grant,merchant]);
  await db.query("INSERT INTO driver_profiles(id,account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,$2,'Synthetic dispatch driver',clock_timestamp()+interval '2 days','APPROVED',clock_timestamp()+interval '1 day',$3,'Local synthetic document fixture')",[driverId,driverAccount,account]);
  await db.query("INSERT INTO driver_vehicles VALUES($1,'MOTORCYCLE','FIXTURE','Fixture','Purple',clock_timestamp()+interval '1 day')",[driverId]);
  await db.query('INSERT INTO driver_occupancy(driver_id) VALUES($1)',[driverId]);
  await db.query("INSERT INTO driver_availability(driver_id,requested_online,heartbeat_expires_at) VALUES($1,true,clock_timestamp()+interval '90 seconds')",[driverId]);
  const dispatcherAccessHash=(await db.query('SELECT access_hash FROM mobile_sessions WHERE id=$1',[dispatcherSession])).rows[0].access_hash;
  await db.query('SET LOCAL ROLE bitpos_app');
  await db.query("SELECT set_config('bitpos.mobile_session',$1,true)",[dispatcherSession]);
  await db.query("SELECT set_config('bitpos.mobile_access_hash',$1,true)",[dispatcherAccessHash]);
  await db.query('SELECT food_discovery_service_command($1,$2,$3,$4::jsonb)',[driverId,merchant,branch,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:'0',enabled:true,validUntil:new Date(Date.now()+1800000).toISOString(),reason:'Synthetic078 rollback fixture explicit FOOD service'})]);
  const ship=(await db.query('SELECT id FROM food_shipments WHERE merchant_id=$1 AND order_id=$2',[merchant,order.id])).rows[0].id;
  await denied('Unpaid order cannot receive a dispatch offer','P0001',()=>db.query('SELECT dispatch_food_offer($1,$2,$3::jsonb)',[ship,driverId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:'1'})]));
  await decideOnlineOrder(client,merchant,account,'owner',order.id,{status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23});
  const attempt=(await fixturePaymentAttempt(client,{merchant,order:order.id,status:'SUBMITTED',signature:'SQL-only-dispatch-fixture-'+randomUUID()})).rows[0];
  await settleAttempt(client,attempt,true);
  if(ownFixture){
   const empty=(await db.query('SELECT bitpos.food_batch_candidates($1,$2,$3) value',[merchant,branch,ship])).rows[0].value;
   assert.deepEqual(empty.items,[],'unready food is not a batch candidate');
   await db.query('SAVEPOINT ready_candidate');await db.query('RESET ROLE');
   await db.query("INSERT INTO bitpos.order_fulfillment(merchant_id,order_id,status,version,updated_at) VALUES($1,$2,'READY',1,clock_timestamp()) ON CONFLICT(merchant_id,order_id) DO UPDATE SET status='READY',version=bitpos.order_fulfillment.version+1,updated_at=clock_timestamp()",[merchant,order.id]);
   await db.query('SET LOCAL ROLE bitpos_app');
   const proposal=(await db.query('SELECT bitpos.food_batch_candidates($1,$2,$3) value',[merchant,branch,ship])).rows[0].value;
   assert.deepEqual(proposal.items.map((v:{shipmentId:string})=>v.shipmentId),[ship]);assert.equal(proposal.assignmentCreated,false);
   assert.deepEqual(Object.keys(proposal.items[0]).sort(),['generation','shipmentId','version']);
   await db.query('SET CONSTRAINTS ALL DEFERRED');
   const extras:string[]=[];
   for(let i=0;i<3;i++){
    const extraQuote=await captureQuote(client,merchant,origin,[{...items[0],lineId:randomUUID()}],authority,customer,{addressId:address,addressVersion:'1',policyVersionId:policy});
    const extraOrder=await createQuotedOrder(client,merchant,{quote:extraQuote,customerId:customer,idempotencyKey:randomUUID(),requestHash:'fixture-extra-'+randomUUID(),screenGeneration:null});
    await decideOnlineOrder(client,merchant,account,'owner',extraOrder.id,{status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23});
    const extraAttempt=(await fixturePaymentAttempt(client,{merchant,order:extraOrder.id,status:'SUBMITTED',signature:'SQL-only-batch-'+randomUUID()})).rows[0];await settleAttempt(client,extraAttempt,true);
    const extraShipment=(await db.query('SELECT id FROM food_shipments WHERE merchant_id=$1 AND order_id=$2',[merchant,extraOrder.id])).rows[0].id;extras.push(extraShipment);
    await db.query('RESET ROLE');await db.query("INSERT INTO bitpos.order_fulfillment(merchant_id,order_id,status,version,updated_at) VALUES($1,$2,'READY',1,clock_timestamp()) ON CONFLICT(merchant_id,order_id) DO UPDATE SET status='READY',version=bitpos.order_fulfillment.version+1,updated_at=clock_timestamp()",[merchant,extraOrder.id]);await db.query('SET LOCAL ROLE bitpos_app');
   }
   const multi=(await db.query('SELECT bitpos.food_batch_candidates($1,$2,$3) value',[merchant,branch,ship])).rows[0].value;
   assert.equal(multi.items.length,3,'three-shipment capacity includes the anchor');
   assert.equal(multi.items[0].shipmentId,ship);assert.ok(multi.items.slice(1).every((v:{shipmentId:string})=>extras.includes(v.shipmentId)));
   if(draftRace){
    await db.query('RESET ROLE');await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('COMMIT');
    const draftCommand={idempotencyKey:randomUUID(),driverId,items:multi.items};
    const run=async()=>{const c=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await c.connect();try{
     await c.query('BEGIN');await c.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[account,dispatcherSession,dispatcherAccessHash]);await c.query('SET LOCAL ROLE bitpos_app');
     const result=(await c.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb) value',[merchant,branch,JSON.stringify(draftCommand)])).rows[0].value;await c.query('COMMIT');return result;
    }catch(error){await c.query('ROLLBACK');throw error;}finally{await c.end();}};
    const first=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await first.connect();let both:any[];
    try{
     await first.query('BEGIN');await first.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[account,dispatcherSession,dispatcherAccessHash]);await first.query('SET LOCAL ROLE bitpos_app');
     const firstReceipt=(await first.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb) value',[merchant,branch,JSON.stringify(draftCommand)])).rows[0].value;
     const second=run();await waitForLock(db,'SELECT bitpos.food_batch_create_draft%');await first.query('COMMIT');
     both=[firstReceipt,await second];assert.deepEqual(both[0],both[1]);
    }finally{await first.query('ROLLBACK').catch(()=>undefined);await first.end();}
    const facts=(await db.query('SELECT (SELECT count(*)::int FROM bitpos.food_batches WHERE id=$1) batches,(SELECT count(*)::int FROM bitpos.food_batch_items WHERE batch_id=$1) items,(SELECT count(*)::int FROM bitpos.food_batch_draft_commands WHERE actor_account_id=$2 AND idempotency_key=$3) commands,(SELECT count(*)::int FROM bitpos.food_assignments WHERE shipment_id=ANY($4::uuid[])) assignments',[both[0].batchId,account,draftCommand.idempotencyKey,multi.items.map((v:{shipmentId:string})=>v.shipmentId)])).rows[0];
    assert.deepEqual(facts,{batches:1,items:3,commands:1,assignments:0});
    await db.query('BEGIN');await db.query('SELECT id FROM bitpos.merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
    const revokedReplay=run().then(()=>null,e=>e);await waitForLock(db,'SELECT bitpos.food_batch_create_draft%');
    await db.query('UPDATE bitpos.platform_staff_role_grants SET revoked_at=clock_timestamp() WHERE id=$1',[grant]);await db.query('COMMIT');
    assert.match(String(await revokedReplay),/ROLE_REQUIRED/,'staff revoked during lock wait cannot replay an old receipt');
    console.log(JSON.stringify({status:'PASS_BATCH_DRAFT_CONCURRENT_REPLAY',facts,fixture:'committed synthetic data on disposable port55440'}));
    throw new Error('JOINED_RACE_COMPLETE');
   }
   await db.query('SAVEPOINT batch_draft');
   const draftCommand={idempotencyKey:randomUUID(),driverId,items:multi.items};
   for(const invalid of [null,[],{...draftCommand,items:'bad'},{...draftCommand,items:[null,null]},{...draftCommand,items:[multi.items[0],{...multi.items[1],version:'x'}]}])await denied('Malformed batch draft rejected','P0001',()=>db.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb)',[merchant,branch,JSON.stringify(invalid)]),'INVALID_REQUEST');
   await denied('Duplicate batch shipment rejected','P0001',()=>db.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb)',[merchant,branch,JSON.stringify({...draftCommand,idempotencyKey:randomUUID(),items:[multi.items[0],multi.items[0]]})]),'INVALID_REQUEST');
   await denied('Unknown batch shipment does not lock another scope','P0001',()=>db.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb)',[merchant,branch,JSON.stringify({...draftCommand,idempotencyKey:randomUUID(),items:[multi.items[0],{...multi.items[1],shipmentId:randomUUID()}]})]),'RESOURCE_NOT_FOUND');
   const draft=(await db.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb) value',[merchant,branch,JSON.stringify(draftCommand)])).rows[0].value;
   assert.equal(draft.state,'DRAFT');assert.equal(draft.assignmentCreated,false);assert.deepEqual(draft.items,multi.items);
   assert.deepEqual((await db.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb) value',[merchant,branch,JSON.stringify(draftCommand)])).rows[0].value,draft);
   await denied('Changed draft retry conflicts','P0001',()=>db.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb)',[merchant,branch,JSON.stringify({...draftCommand,items:multi.items.slice(0,2)})]),'IDEMPOTENCY_CONFLICT');
   await denied('Stale draft version rejected','P0001',()=>db.query('SELECT bitpos.food_batch_create_draft($1,$2,$3::jsonb)',[merchant,branch,JSON.stringify({...draftCommand,idempotencyKey:randomUUID(),items:[{...multi.items[0],version:'999'},...multi.items.slice(1)]})]),'VERSION_CONFLICT');
   const offerPreparation={idempotencyKey:randomUUID(),expectedVersion:'1'};
   await denied('Application cannot prepare incomplete batch offers','42501',()=>db.query('SELECT bitpos.food_batch_prepare_offer($1,$2::jsonb)',[draft.batchId,JSON.stringify(offerPreparation)]));
   await db.query('RESET ROLE');assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_batch_items WHERE batch_id=$1',[draft.batchId])).rows[0].n,3);
   assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_assignments WHERE shipment_id=ANY($1::uuid[])',[multi.items.map((v:{shipmentId:string})=>v.shipmentId)])).rows[0].n,0,'draft creates no assignment');
   await db.query('SAVEPOINT offer_stale');await db.query("UPDATE bitpos.order_fulfillment SET status='PREPARING' WHERE order_id=(SELECT order_id FROM bitpos.food_shipments WHERE id=$1)",[multi.items[1].shipmentId]);
   await denied('Offer preparation rejects stale readiness','P0001',()=>db.query('SELECT bitpos.food_batch_prepare_offer($1,$2::jsonb)',[draft.batchId,JSON.stringify(offerPreparation)]),'VERSION_CONFLICT');
   await db.query('ROLLBACK TO SAVEPOINT offer_stale');await db.query('RELEASE SAVEPOINT offer_stale');
   const prepared=(await db.query('SELECT bitpos.food_batch_prepare_offer($1,$2::jsonb) value',[draft.batchId,JSON.stringify(offerPreparation)])).rows[0].value;
   assert.equal(prepared.driverNotified,false);assert.equal(prepared.assignmentCreated,false);
   assert.deepEqual((await db.query('SELECT bitpos.food_batch_prepare_offer($1,$2::jsonb) value',[draft.batchId,JSON.stringify(offerPreparation)])).rows[0].value,prepared);
   await denied('Second offer preparation rejected','P0001',()=>db.query('SELECT bitpos.food_batch_prepare_offer($1,$2::jsonb)',[draft.batchId,JSON.stringify({...offerPreparation,idempotencyKey:randomUUID()})]),'OFFER_PENDING');
   assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_dispatch_offers WHERE shipment_id=ANY($1::uuid[])',[multi.items.map((v:{shipmentId:string})=>v.shipmentId)])).rows[0].n,0,'private preparation publishes no driver offer');
   if(batchReplayRace){
    const access=(await db.query('SELECT access_hash FROM bitpos.mobile_sessions WHERE id=$1',[driverSession])).rows[0].access_hash;
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('COMMIT');
    const first=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});const second=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await first.connect();await second.connect();
    try{
     for(const c of [first,second]){await c.query('BEGIN');await c.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[driverAccount,driverSession,access]);}
     const key=randomUUID(),sql='SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb) value',args=[prepared.preparationId,JSON.stringify({idempotencyKey:key,expectedVersion:'1'})];
     const original=(await first.query(sql,args)).rows[0].value;
     const waiting=second.query(sql,args);await waitForLock(db,'SELECT bitpos.food_batch_claim_candidate%');await first.query('COMMIT');
     const replay=(await waiting).rows[0].value;await second.query('COMMIT');assert.deepEqual(replay,original);
     const facts=(await db.query("SELECT (SELECT count(*)::int FROM bitpos.food_batch_leases WHERE batch_id=$1 AND state='ACTIVE') leases,(SELECT count(*)::int FROM bitpos.food_batch_legs WHERE batch_id=$1) legs,(SELECT count(*)::int FROM bitpos.food_dispatch_commands WHERE actor_account_id=$2 AND idempotency_key=$3 AND operation='batch-claim') commands",[draft.batchId,driverAccount,key])).rows[0];
     assert.deepEqual(facts,{leases:1,legs:3,commands:1});
     await db.query('BEGIN');await db.query('SELECT id FROM bitpos.merchants WHERE id=$1 FOR NO KEY UPDATE',[merchant]);
     await second.query('BEGIN');await second.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[driverAccount,driverSession,access]);
     const revoked=second.query(sql,args).then(()=>null,e=>e);await waitForLock(db,'SELECT bitpos.food_batch_claim_candidate%');
     await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[driverSession]);await db.query('COMMIT');
     assert.match(String(await revoked),/AUTH_REQUIRED/);await second.query('ROLLBACK');
     console.log(JSON.stringify({status:'PASS_PRIVATE_BATCH_CONCURRENT_REPLAY',facts,revokedReplay:'denied',fixture:'committed synthetic data on disposable port55440'}));
    }finally{await first.query('ROLLBACK').catch(()=>undefined);await second.query('ROLLBACK').catch(()=>undefined);await first.end();await second.end();}
    throw new Error('JOINED_RACE_COMPLETE');
   }
   if(batchOfferRace){
    const access=(await db.query('SELECT access_hash FROM bitpos.mobile_sessions WHERE id=$1',[driverSession])).rows[0].access_hash;
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('COMMIT');
    const claimDb=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});const offerDb=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await claimDb.connect();await offerDb.connect();
    try{
     await claimDb.query('BEGIN');await claimDb.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[driverAccount,driverSession,access]);
     await offerDb.query('BEGIN');await offerDb.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[account,dispatcherSession,dispatcherAccessHash]);await offerDb.query('SET LOCAL ROLE bitpos_app');
     const claimSql='SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb) value',claimArgs=[prepared.preparationId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:'1'})];
     const offerSql='SELECT bitpos.dispatch_food_offer($1,$2,$3::jsonb) value',offerArgs=[ship,driverId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:multi.items[0].version})];
     if(batchOfferRace==='batch'){
      const claim=(await claimDb.query(claimSql,claimArgs)).rows[0].value;
      const pending=offerDb.query(offerSql,offerArgs).then(()=>null,e=>e);
      await waitForLock(db,'SELECT bitpos.dispatch_food_offer%');await claimDb.query('COMMIT');
      assert.match(String(await pending),/OFFER_UNAVAILABLE/);await offerDb.query('ROLLBACK');assert.equal(claim.state,'ACTIVE');
     }else{
      const offer=(await offerDb.query(offerSql,offerArgs)).rows[0].value;
      const pending=claimDb.query(claimSql,claimArgs).then(()=>null,e=>e);
      await waitForLock(db,'SELECT bitpos.food_batch_claim_candidate%');await offerDb.query('COMMIT');
      assert.match(String(await pending),/VERSION_CONFLICT/);await claimDb.query('ROLLBACK');assert.ok(offer.offerId);
     }
     const facts=(await db.query("SELECT (SELECT count(*)::int FROM bitpos.food_batch_leases WHERE driver_id=$1 AND state='ACTIVE') batches,(SELECT count(*)::int FROM bitpos.food_batch_legs WHERE batch_id=$3 AND closed_at IS NULL) legs,(SELECT count(*)::int FROM bitpos.food_dispatch_offers WHERE shipment_id=$2 AND state='OFFERED') offers",[driverId,ship,draft.batchId])).rows[0];
     assert.deepEqual(facts,batchOfferRace==='batch'?{batches:1,legs:3,offers:0}:{batches:0,legs:0,offers:1});
     console.log(JSON.stringify({status:'PASS_PRIVATE_BATCH_SINGLE_OFFER_RACE',winner:batchOfferRace,facts,fixture:'committed synthetic data on disposable port55440'}));
    }finally{await claimDb.query('ROLLBACK').catch(()=>undefined);await offerDb.query('ROLLBACK').catch(()=>undefined);await claimDb.end();await offerDb.end();}
    throw new Error('JOINED_RACE_COMPLETE');
   }
   if(batchRace){
    const fare=(await db.query("INSERT INTO bitpos.ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,published_by) VALUES('THB',2,1,1,1,1,0,$1) RETURNING id",[account])).rows[0].id;
    const trip=(await db.query("INSERT INTO bitpos.passenger_trips(rider_account_id,idempotency_key,seats,shared,rate_id,currency,decimals,fare_minor,distance_metres,duration_seconds,pickup_lat_e7,pickup_lng_e7,dropoff_lat_e7,dropoff_lng_e7,pin_salt,pin_hash) VALUES($1,$2,1,false,$3,'THB',2,1,1,1,0,0,1,1,'fixture','fixture') RETURNING id",[account,randomUUID(),fare])).rows[0].id;
    const access=(await db.query('SELECT access_hash FROM bitpos.mobile_sessions WHERE id=$1',[driverSession])).rows[0].access_hash;
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('COMMIT');
    const claimDb=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});const rideDb=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await claimDb.connect();await rideDb.connect();
    try{
     await claimDb.query('BEGIN');await claimDb.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[driverAccount,driverSession,access]);
     const claimSql='SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb) value', claimArgs=[prepared.preparationId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:'1'})];
     const rideSql="UPDATE bitpos.passenger_trips SET state='MATCHED',driver_account_id=$2 WHERE id=$1";
     await rideDb.query('BEGIN');
     if(batchRace==='batch'){
      const claim=(await claimDb.query(claimSql,claimArgs)).rows[0].value;
      const pending=rideDb.query(rideSql,[trip,driverAccount]).then(()=>null,e=>e);
      await waitForLock(db,'UPDATE bitpos.passenger_trips SET state=%');await claimDb.query('COMMIT');
      assert.match(String(await pending),/DRIVER_BUSY/);await rideDb.query('ROLLBACK');assert.equal(claim.state,'ACTIVE');
     }else{
      await rideDb.query(rideSql,[trip,driverAccount]);
      const pending=claimDb.query(claimSql,claimArgs).then(()=>null,e=>e);
      await waitForLock(db,'SELECT bitpos.food_batch_claim_candidate%');await rideDb.query('COMMIT');
      assert.match(String(await pending),/DRIVER_UNAVAILABLE/);await claimDb.query('ROLLBACK');
     }
     const facts=(await db.query("SELECT (SELECT count(*)::int FROM bitpos.food_batch_leases WHERE driver_id=$1 AND state='ACTIVE') batches,(SELECT count(*)::int FROM bitpos.food_batch_legs WHERE batch_id=$3 AND closed_at IS NULL) legs,(SELECT count(*)::int FROM bitpos.passenger_trips WHERE driver_account_id=$2 AND state IN('MATCHED','ARRIVED','IN_TRIP')) rides",[driverId,driverAccount,draft.batchId])).rows[0];
     assert.deepEqual(facts,batchRace==='batch'?{batches:1,legs:3,rides:0}:{batches:0,legs:0,rides:1});
     console.log(JSON.stringify({status:'PASS_PRIVATE_BATCH_RIDE_RACE',winner:batchRace,facts,fixture:'committed synthetic data on disposable port55440'}));
    }finally{await claimDb.query('ROLLBACK').catch(()=>undefined);await rideDb.query('ROLLBACK').catch(()=>undefined);await claimDb.end();await rideDb.end();}
    throw new Error('JOINED_RACE_COMPLETE');
   }
   await db.query('SAVEPOINT batch_claim_candidate');
   const batchClaim={idempotencyKey:randomUUID(),expectedVersion:'1'};
   await db.query('SET LOCAL ROLE bitpos_app');await denied('Application cannot claim incomplete batch','42501',()=>db.query('SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb)',[prepared.preparationId,JSON.stringify(batchClaim)]));await db.query('RESET ROLE');
   const claimAccessHash=(await db.query('SELECT access_hash FROM bitpos.mobile_sessions WHERE id=$1',[driverSession])).rows[0].access_hash;
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[driverAccount,driverSession,claimAccessHash]);
   await db.query('SAVEPOINT claim_expired');
   await db.query("SET LOCAL session_replication_role='replica'");
   await db.query("UPDATE bitpos.food_batch_offer_preparations SET prepared_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1",[prepared.preparationId]);
   await db.query("SET LOCAL session_replication_role='origin'");
   await denied('Expired batch preparation cannot be claimed','P0001',()=>db.query('SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb)',[prepared.preparationId,JSON.stringify(batchClaim)]),'OFFER_UNAVAILABLE');
   await db.query('ROLLBACK TO SAVEPOINT claim_expired');await db.query('RELEASE SAVEPOINT claim_expired');
   await db.query('SAVEPOINT claim_stale');
   await db.query("UPDATE bitpos.order_fulfillment SET status='PREPARING' WHERE order_id=(SELECT order_id FROM bitpos.food_shipments WHERE id=$1)",[multi.items[1].shipmentId]);
   await denied('Batch claim rejects changed readiness','P0001',()=>db.query('SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb)',[prepared.preparationId,JSON.stringify(batchClaim)]),'VERSION_CONFLICT');
   assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_batch_leases WHERE batch_id=$1',[draft.batchId])).rows[0].n,0,'failed claims leave no lease');
   assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.food_batch_legs WHERE batch_id=$1',[draft.batchId])).rows[0].n,0,'failed claims leave no legs');
   await db.query('ROLLBACK TO SAVEPOINT claim_stale');await db.query('RELEASE SAVEPOINT claim_stale');
   let batchRideId:string|undefined;
   if(ownFixture){
    const fare=(await db.query("INSERT INTO bitpos.ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,published_by) VALUES('THB',2,1,1,1,1,0,$1) RETURNING id",[account])).rows[0].id;
    batchRideId=(await db.query("INSERT INTO bitpos.passenger_trips(rider_account_id,idempotency_key,seats,shared,rate_id,currency,decimals,fare_minor,distance_metres,duration_seconds,pickup_lat_e7,pickup_lng_e7,dropoff_lat_e7,dropoff_lng_e7,pin_salt,pin_hash) VALUES($1,$2,1,false,$3,'THB',2,1,1,1,0,0,1,1,'fixture','fixture') RETURNING id",[account,randomUUID(),fare])).rows[0].id;
    await db.query('SAVEPOINT batch_active_ride');
    await db.query("UPDATE bitpos.passenger_trips SET state='MATCHED',driver_account_id=$2 WHERE id=$1",[batchRideId,driverAccount]);
    await denied('Active ride driver cannot enter a batch draft','P0001',()=>db.query('INSERT INTO bitpos.food_batches(id,merchant_id,branch_id,driver_id) VALUES($1,$2,$3,$4)',[randomUUID(),merchant,branch,driverId]),'DRIVER_UNAVAILABLE');
    await denied('Batch claim refuses an active ride','P0001',()=>db.query('SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb)',[prepared.preparationId,JSON.stringify(batchClaim)]),'DRIVER_UNAVAILABLE');
    await db.query('ROLLBACK TO SAVEPOINT batch_active_ride');await db.query('RELEASE SAVEPOINT batch_active_ride');
   }
   const batchClaimed=(await db.query('SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb) value',[prepared.preparationId,JSON.stringify(batchClaim)])).rows[0].value;
   assert.equal(batchClaimed.state,'ACTIVE');assert.equal(batchClaimed.shipments.length,3);
   assert.deepEqual((await db.query('SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb) value',[prepared.preparationId,JSON.stringify(batchClaim)])).rows[0].value,batchClaimed);
   await denied('Changed batch claim retry conflicts','P0001',()=>db.query('SELECT bitpos.food_batch_claim_candidate($1,$2::jsonb)',[prepared.preparationId,JSON.stringify({...batchClaim,expectedVersion:'2'})]),'IDEMPOTENCY_CONFLICT');
   assert.equal((await db.query("SELECT count(*)::int n FROM bitpos.food_batch_legs WHERE batch_id=$1 AND state='ACCEPTED' AND closed_at IS NULL",[draft.batchId])).rows[0].n,3);
   assert.equal((await db.query("SELECT count(*)::int n FROM bitpos.food_batch_leases WHERE batch_id=$1 AND state='ACTIVE'",[draft.batchId])).rows[0].n,1);
   await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('SET CONSTRAINTS ALL DEFERRED');
   await denied('Batch root cannot change tenant or driver','23514',()=>db.query('UPDATE bitpos.food_batches SET driver_id=$2 WHERE id=$1',[draft.batchId,randomUUID()]),'BATCH_IDENTITY_IMMUTABLE');
   await denied('Batch leg cannot be deleted','23514',()=>db.query('DELETE FROM bitpos.food_batch_legs WHERE batch_id=$1 AND shipment_id=$2',[draft.batchId,multi.items[0].shipmentId]),'BATCH_IDENTITY_IMMUTABLE');
   await denied('Active batch cannot release lease alone','23514',()=>db.query("UPDATE bitpos.food_batch_leases SET state='RELEASED',released_at=clock_timestamp() WHERE batch_id=$1",[draft.batchId]),'BATCH_AUTHORITY_GRAPH');
   await denied('Active batch cannot change driver generation','23514',()=>db.query('UPDATE bitpos.driver_occupancy SET assignment_generation=assignment_generation+1 WHERE driver_id=$1',[driverId]),'BATCH_ACTIVE_GENERATION');
   await denied('Batch cannot be cancelled with live legs','23514',()=>db.query("UPDATE bitpos.food_batches SET state='CANCELLED' WHERE id=$1",[draft.batchId]),'BATCH_AUTHORITY_GRAPH');
   if(batchRideId)await denied('Active batch refuses a ride match','P0001',()=>db.query("UPDATE bitpos.passenger_trips SET state='MATCHED',driver_account_id=$2 WHERE id=$1",[batchRideId,driverAccount]),'DRIVER_BUSY');
   await denied('Single food lease blocked by active batch','P0001',()=>db.query("INSERT INTO bitpos.driver_assignment_leases(id,driver_id,generation,food_assignment_id,state) VALUES($1,$2,999999,$3,'ACTIVE')",[randomUUID(),driverId,randomUUID()]),'DRIVER_UNAVAILABLE');
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[account,dispatcherSession,dispatcherAccessHash]);
   const reservedCandidates=(await db.query('SELECT bitpos.food_batch_candidates($1,$2,$3) value',[merchant,branch,ship])).rows[0].value;
   assert.deepEqual(reservedCandidates.items,[],'active batch anchor is excluded from candidates');
   passed.push('Active batch members are excluded from staff candidates');
   await denied('Single food offer blocked by active batch','P0001',()=>db.query('SELECT bitpos.dispatch_food_offer($1,$2,$3::jsonb)',[ship,driverId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:multi.items[0].version})]),'OFFER_UNAVAILABLE');
   const unrelated=extras.find(id=>!multi.items.some((v:{shipmentId:string})=>v.shipmentId===id));assert.ok(unrelated);
   const unrelatedVersion=(await db.query('SELECT version::text version FROM bitpos.food_shipments WHERE id=$1',[unrelated])).rows[0].version;
   await denied('Active batch driver cannot receive an unrelated single offer','P0001',()=>db.query('SELECT bitpos.dispatch_food_offer($1,$2,$3::jsonb)',[unrelated,driverId,JSON.stringify({idempotencyKey:randomUUID(),expectedVersion:unrelatedVersion})]),'DRIVER_UNAVAILABLE');
   await denied('Active batch driver cannot enter another draft','P0001',()=>db.query('INSERT INTO bitpos.food_batches(id,merchant_id,branch_id,driver_id) VALUES($1,$2,$3,$4)',[randomUUID(),merchant,branch,driverId]),'DRIVER_UNAVAILABLE');
   await denied('Active batch driver cannot enter another preparation','P0001',()=>db.query('INSERT INTO bitpos.food_batch_offer_preparations(id,batch_id,batch_version,driver_id,prepared_by,prepared_at,expires_at) SELECT $2,batch_id,batch_version,driver_id,prepared_by,prepared_at,expires_at FROM bitpos.food_batch_offer_preparations WHERE id=$1',[prepared.preparationId,randomUUID()]),'DRIVER_UNAVAILABLE');

   await db.query('ROLLBACK TO SAVEPOINT batch_claim_candidate');await db.query('RELEASE SAVEPOINT batch_claim_candidate');
   await db.query('ROLLBACK TO SAVEPOINT batch_draft');await db.query('RELEASE SAVEPOINT batch_draft');await db.query('SET LOCAL ROLE bitpos_app');
   await db.query('SAVEPOINT batch_storage');await db.query('RESET ROLE');
   const batch=randomUUID();await db.query('INSERT INTO bitpos.food_batches(id,merchant_id,branch_id,driver_id) VALUES($1,$2,$3,$4)',[batch,merchant,branch,driverId]);
   await denied('Batch storage rejects one shipment','23514',async()=>{await db.query('INSERT INTO bitpos.food_batch_items(batch_id,merchant_id,branch_id,shipment_id,shipment_version,shipment_generation,position) VALUES($1,$2,$3,$4,1,0,1)',[batch,merchant,branch,ship]);});
   for(const [i,item] of multi.items.entries())await db.query('INSERT INTO bitpos.food_batch_items(batch_id,merchant_id,branch_id,shipment_id,shipment_version,shipment_generation,position) VALUES($1,$2,$3,$4,$5,$6,$7)',[batch,merchant,branch,item.shipmentId,item.version,item.generation,i+1]);
   await db.query('SET CONSTRAINTS ALL IMMEDIATE');
   await denied('Batch member history is immutable','23514',()=>db.query('DELETE FROM bitpos.food_batch_items WHERE batch_id=$1',[batch]));
   await db.query('SET LOCAL ROLE bitpos_app');await denied('Application cannot directly read batch storage','42501',()=>db.query('SELECT * FROM bitpos.food_batches'));
   await db.query('RESET ROLE');await db.query('ROLLBACK TO SAVEPOINT batch_storage');await db.query('RELEASE SAVEPOINT batch_storage');await db.query('SET LOCAL ROLE bitpos_app');
   await db.query('RESET ROLE');await db.query("UPDATE bitpos.order_fulfillment SET status='PREPARING' WHERE order_id=(SELECT order_id FROM bitpos.food_shipments WHERE id=$1)",[multi.items[1].shipmentId]);await db.query('SET LOCAL ROLE bitpos_app');
   const afterChange=(await db.query('SELECT bitpos.food_batch_candidates($1,$2,$3) value',[merchant,branch,ship])).rows[0].value;
   assert.ok(!afterChange.items.some((v:{shipmentId:string})=>v.shipmentId===multi.items[1].shipmentId),'readiness change excludes that shipment');
   assert.equal(afterChange.items.length,3,'another eligible shipment fills the capacity');
   await db.query('SAVEPOINT batch_pair_geometry');await db.query('RESET ROLE');await db.query("SET LOCAL session_replication_role='replica'");
   for(const [index,offset,minutes] of [[0,-100000,-4],[1,100000,4],[2,300000,0]] as const){
    await db.query('UPDATE bitpos.quote_delivery_snapshots q SET longitude_e7=$2 FROM bitpos.food_shipments s WHERE s.id=$1 AND (q.merchant_id,q.quote_id)=(s.merchant_id,s.quote_id)',[extras[index],1005018001+offset]);
    await db.query("UPDATE bitpos.order_fulfillment f SET status='READY',updated_at=clock_timestamp()+($2::int*interval '1 minute') FROM bitpos.food_shipments s WHERE s.id=$1 AND (f.merchant_id,f.order_id)=(s.merchant_id,s.order_id)",[extras[index],minutes]);
   }
   await db.query("SET LOCAL session_replication_role='origin'");await db.query('SET LOCAL ROLE bitpos_app');
   const pair=(await db.query('SELECT bitpos.food_batch_candidates($1,$2,$3) value',[merchant,branch,ship])).rows[0].value;
   assert.deepEqual(pair.items.map((v:{shipmentId:string})=>v.shipmentId),[ship,extras[0]],'every pair must be near and ready within the time window');
   await db.query('RESET ROLE');await db.query('ROLLBACK TO SAVEPOINT batch_pair_geometry');await db.query('RELEASE SAVEPOINT batch_pair_geometry');await db.query('SET LOCAL ROLE bitpos_app');
   await db.query('RESET ROLE');const driverAccessHash=(await db.query('SELECT access_hash FROM bitpos.mobile_sessions WHERE id=$1',[driverSession])).rows[0].access_hash;await db.query('SET LOCAL ROLE bitpos_app');
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true),set_config('bitpos.mobile_access_hash',$3,true)",[driverAccount,driverSession,driverAccessHash]);
   await denied('Driver without dispatcher scope cannot read batch candidates','P0001',()=>db.query('SELECT bitpos.food_batch_candidates($1,$2,$3)',[merchant,branch,ship]),'ROLE_REQUIRED');
   await db.query('RESET ROLE');await db.query('ROLLBACK TO SAVEPOINT ready_candidate');await db.query('RELEASE SAVEPOINT ready_candidate');await db.query('SET LOCAL ROLE bitpos_app');
   passed.push('Scoped read-only batch candidates require actual ready state and omit private destination');
  }
  const offerCommand={idempotencyKey:randomUUID(),expectedVersion:'1'};
  const offered=(await db.query('SELECT dispatch_food_offer($1,$2,$3::jsonb) AS value',[ship,driverId,JSON.stringify(offerCommand)])).rows[0].value;
  assert.deepEqual((await db.query('SELECT dispatch_food_offer($1,$2,$3::jsonb) AS value',[ship,driverId,JSON.stringify(offerCommand)])).rows[0].value,offered);
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[driverAccount,driverSession]);
  const inbox=FoodDriverWorkSchema.parse((await db.query('SELECT dispatch_driver_work() AS value')).rows[0].value);assert.equal(inbox.assignment,null);assert.equal(inbox.offers[0].id,offered.offerId);assert.equal('addressText' in inbox.offers[0],false);
  const claimCommand={idempotencyKey:randomUUID(),expectedVersion:'1',generation:offered.generation};
  let rideId:string|undefined;
  if(ownFixture){
   await db.query('RESET ROLE');
   const fare=(await db.query("INSERT INTO ride_fare_rates(currency,decimals,base_minor,per_km_minor,per_minute_minor,minimum_minor,shared_discount_bps,published_by) VALUES('THB',2,1,1,1,1,0,$1) RETURNING id",[account])).rows[0].id;
   rideId=(await db.query("INSERT INTO passenger_trips(rider_account_id,idempotency_key,seats,shared,rate_id,currency,decimals,fare_minor,distance_metres,duration_seconds,pickup_lat_e7,pickup_lng_e7,dropoff_lat_e7,dropoff_lng_e7,pin_salt,pin_hash) VALUES($1,$2,1,false,$3,'THB',2,1,1,1,0,0,1,1,'fixture','fixture') RETURNING id",[account,randomUUID(),fare])).rows[0].id;
   if(!rideId)throw Error('Synthetic ride was not created');
   if(joinedRace){
    // Commit only synthetic fixture facts on the explicitly selected disposable cluster so independent connections can race.
    await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('COMMIT');
    const claimDb=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await claimDb.connect();
    const {acceptTrip}=await import('../../apps/api/src/passenger-trips');
    try{
     await claimDb.query('BEGIN');
     await claimDb.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[driverAccount,driverSession]);
     await claimDb.query('SET LOCAL ROLE bitpos_app');
     if(joinedRace==='food'){
      const claimed=(await claimDb.query('SELECT bitpos.dispatch_food_claim($1,$2::jsonb) value',[offered.offerId,JSON.stringify(claimCommand)])).rows[0].value;
      const waiting=acceptTrip(driverAccount,rideId).then(()=>null,e=>e);
      await waitForLock(db,"UPDATE passenger_trips SET state=%");
      await claimDb.query('COMMIT');
      assert.match(String(await waiting),/DRIVER_BUSY/);
      assert.ok(claimed.assignmentId);
     }else{
      await db.query('BEGIN');await db.query("UPDATE bitpos.passenger_trips SET state='MATCHED',driver_account_id=$2 WHERE id=$1",[rideId,driverAccount]);
      const waiting=claimDb.query('SELECT bitpos.dispatch_food_claim($1,$2::jsonb)',[offered.offerId,JSON.stringify(claimCommand)]).then(()=>null,e=>e);
      await waitForLock(db,'SELECT bitpos.dispatch_food_claim%');
      await db.query('COMMIT');
      assert.match(String(await waiting),/DRIVER_UNAVAILABLE/);await claimDb.query('ROLLBACK');
     }
     const facts=(await db.query("SELECT (SELECT count(*)::int FROM bitpos.driver_assignment_leases WHERE driver_id=$1 AND state='ACTIVE') food,(SELECT count(*)::int FROM bitpos.passenger_trips WHERE driver_account_id=$2 AND state IN('MATCHED','ARRIVED','IN_TRIP')) rides",[driverId,driverAccount])).rows[0];
     assert.deepEqual(facts,joinedRace==='food'?{food:1,rides:0}:{food:0,rides:1});
     console.log(JSON.stringify({status:'PASS_JOINED_FOOD_RIDE_RACE',winner:joinedRace,fixture:'committed synthetic facts on disposable port55440',facts}));
    }finally{await db.query('ROLLBACK').catch(()=>undefined);await claimDb.query('ROLLBACK').catch(()=>undefined);await claimDb.end();}
    throw new Error('JOINED_RACE_COMPLETE');
   }
   await db.query('SAVEPOINT active_ride');
   await db.query("UPDATE passenger_trips SET state='MATCHED',driver_account_id=$2 WHERE id=$1",[rideId,driverAccount]);
   await db.query('SET LOCAL ROLE bitpos_app');
   await denied('Actual food claim refuses an active ride','P0001',()=>db.query('SELECT dispatch_food_claim($1,$2::jsonb)',[offered.offerId,JSON.stringify(claimCommand)]),'DRIVER_UNAVAILABLE');
   await db.query('RESET ROLE');await db.query('ROLLBACK TO SAVEPOINT active_ride');await db.query('RELEASE SAVEPOINT active_ride');await db.query('SET LOCAL ROLE bitpos_app');
  }
  await db.query('SET CONSTRAINTS ALL DEFERRED');
  const claimed=(await db.query('SELECT dispatch_food_claim($1,$2::jsonb) AS value',[offered.offerId,JSON.stringify(claimCommand)])).rows[0].value;
  if(rideId){
   await db.query('RESET ROLE');
   await denied('Actual food assignment refuses a ride match','P0001',()=>db.query("UPDATE passenger_trips SET state='MATCHED',driver_account_id=$2 WHERE id=$1",[rideId,driverAccount]),'DRIVER_BUSY');
   await db.query('SET LOCAL ROLE bitpos_app');
  }
  assert.deepEqual((await db.query('SELECT dispatch_food_claim($1,$2::jsonb) AS value',[offered.offerId,JSON.stringify(claimCommand)])).rows[0].value,claimed);
  const arrived=(await db.query('SELECT dispatch_food_arrive($1,$2::jsonb) AS value',[claimed.assignmentId,JSON.stringify({idempotencyKey:randomUUID(),generation:claimed.generation,leaseGeneration:claimed.leaseGeneration,stage:'PICKUP'})])).rows[0].value;
  assert.equal(arrived.state,'AT_PICKUP');
  const activeWork=FoodDriverWorkSchema.parse((await db.query('SELECT dispatch_driver_work() AS value')).rows[0].value);assert.equal(activeWork.assignment?.id,claimed.assignmentId);assert.ok(activeWork.assignment?.access==='NORMAL');assert.equal(activeWork.assignment.addressText,'Synthetic destination');assert.equal(activeWork.assignment.earning.amountMinor,'100');
  passed.push('Unclaimed inbox omits destination; current assigned work recovers exact frozen destination and driver earning');
  await db.query('SET CONSTRAINTS ALL IMMEDIATE');
  passed.push('Synthetic canonical settlement then scoped offer, duplicate offer/claim and driver pickup arrival persist one active assignment');
  const aged=process.argv.includes('--aged-location'),captured=new Date(Date.now()-(aged?60000:0)).toISOString(),locationArgs=[claimed.assignmentId,claimed.generation,claimed.leaseGeneration,'1',captured,137560001,1005018001,5000];
  const locationSql='SELECT dispatch_food_location($1,$2,$3,$4,$5,$6,$7,$8) AS value';
  const location=(await db.query(locationSql,locationArgs)).rows[0].value;assert.equal(location.replayed,false);
  const replayLocation=(await db.query(locationSql,locationArgs)).rows[0].value;assert.equal(replayLocation.replayed,true);assert.equal(replayLocation.receivedAt,location.receivedAt);
  await denied('Conflicting location sequence denied','P0001',()=>db.query(locationSql,[...locationArgs.slice(0,5),137560002,1005018001,5000]));
  await denied('Fresh location rate limited','P0001',()=>db.query(locationSql,[claimed.assignmentId,claimed.generation,claimed.leaseGeneration,'2',new Date(Date.now()+1000).toISOString(),137560001,1005018001,5000]));
  await denied('Stale lease generation cannot upload location','P0001',()=>db.query(locationSql,[claimed.assignmentId,claimed.generation,String(BigInt(claimed.leaseGeneration)+1n),'2',captured,137560001,1005018001,5000]));
  passed.push('Assigned-driver exact location replay preserves receive time; conflicting sequence, rate and stale lease denied');
  const driverTracking=(await db.query('SELECT dispatch_food_tracking($1) AS value',[ship])).rows[0].value;
  assert.equal(driverTracking.location.sequence,'1');assert.equal(driverTracking.location.stale,aged,'Tracking freshness must use capture age, not merely recent receipt');
  await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[account,dispatcherSession]);
  const ownerTracking=(await db.query('SELECT dispatch_food_tracking($1) AS value',[ship])).rows[0].value;
  assert.deepEqual(ownerTracking,driverTracking);passed.push('Shipment owner and assigned driver receive the same private latest location');
  await denied('Customer cannot upload assigned driver location','P0001',()=>db.query(locationSql,[claimed.assignmentId,claimed.generation,claimed.leaseGeneration,'2',captured,137560001,1005018001,5000]));
  if(process.argv.includes('--custody')){
   await db.query('RESET ROLE');await foodSmokeMigration(db,'062_food_earning_obligations.sql',"to_regclass('bitpos.ledger_accounts')");
   await foodSmokeMigration(db,'063_food_custody_earnings.sql',"to_regprocedure('bitpos.food_finalize_earning(uuid)')");
   await foodSmokeMigration(db,'064_food_allocation_guards.sql',"to_regprocedure('bitpos.food_allocation_guard()')");
   const staff=hash(randomUUID());let secret=hash(randomUUID());
   await db.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[account,merchant]);
   await db.query("INSERT INTO sessions(token_hash,user_id,merchant_id,role,expires_at) VALUES($1,$2,$3,'owner',clock_timestamp()+interval '1 hour')",[staff,account,merchant]);
   await db.query('SET LOCAL ROLE bitpos_app');
   await denied('Merchant cannot insert an already-collected delivery without proof','P0001',()=>db.query("INSERT INTO order_fulfillment(merchant_id,order_id,status) VALUES($1,$2,'COLLECTED')",[merchant,order.id]));
   await db.query('RESET ROLE');
   await db.query('INSERT INTO order_fulfillment(merchant_id,order_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[merchant,order.id]);
   await db.query("UPDATE order_fulfillment SET status='READY' WHERE merchant_id=$1 AND order_id=$2",[merchant,order.id]);
   await db.query('SET LOCAL ROLE bitpos_app');
   const merchantWork=FoodMerchantWorkSchema.parse((await db.query('SELECT dispatch_merchant_work($1,$2) AS value',[order.id,staff])).rows[0].value);assert.equal(merchantWork.assignment?.id,claimed.assignmentId);assert.equal(merchantWork.assignment?.pickupProof,null);
   await denied('Invalid merchant session cannot recover custody work','P0001',()=>db.query('SELECT dispatch_merchant_work($1,$2)',[order.id,hash(randomUUID())]));
   await denied('Merchant order path cannot issue proof for another order','P0001',()=>db.query('SELECT dispatch_merchant_issue_proof($1,$2,$3,$4,$5,$6,false,$7)',[randomUUID(),claimed.assignmentId,claimed.generation,claimed.leaseGeneration,randomUUID(),secret,staff]));
   await denied('Merchant cannot mark delivery collected without driver proof','P0001',()=>db.query("UPDATE order_fulfillment SET status='COLLECTED' WHERE merchant_id=$1 AND order_id=$2",[merchant,order.id]));
   const issueKey=randomUUID(),issueArgs=[claimed.assignmentId,claimed.generation,claimed.leaseGeneration,issueKey,secret,staff],issueSql="SELECT dispatch_issue_proof($1,'PICKUP',$2,$3,$4,$5,false,$6) AS value";
   async function issuerExpiryWait(kind:'PICKUP'|'DELIVERY',sql:string,args:unknown[]){
    if(!process.argv.includes('--issuer-expiry'))return;
    assert.match(fixtureDatabase,/^bitpos_dispatch_expiry_fixture(?:_[0-9]+)?$/);
    await db.query('RESET ROLE');
    const context=(await db.query("SELECT current_setting('bitpos.mobile_account') AS account,current_setting('bitpos.mobile_session') AS session,pg_backend_pid() AS pid")).rows[0];
    const eventsBefore=(await db.query('SELECT event_sequence::text AS sequence FROM food_shipments WHERE id=$1',[ship])).rows[0].sequence;
    if(kind==='PICKUP')await db.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1",[staff]);
    else await db.query("UPDATE mobile_sessions SET access_expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[dispatcherSession]);
    await db.query('COMMIT');
    const blocker=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await blocker.connect();
    try{
     await blocker.query('BEGIN');await blocker.query('SELECT 1 FROM bitpos.driver_occupancy WHERE driver_id=$1 FOR UPDATE',[driverId]);
     const blockerPid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
     await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');
     await db.query("SELECT set_config('bitpos.merchant',$1,true),set_config('bitpos.mobile_account',$2,true),set_config('bitpos.mobile_session',$3,true)",[merchant,context.account,context.session]);await db.query('SET LOCAL ROLE bitpos_app');await db.query('SAVEPOINT expiry_wait');
     const pending=db.query(sql,args).then(()=>({message:'unexpected_success'}),error=>({message:(error as Error).message}));
     let waiting=false;for(let attempt=0;attempt<10&&!waiting;attempt++){await blocker.query('SELECT pg_sleep(0.05)');waiting=(await blocker.query('SELECT $1::integer=ANY(pg_blocking_pids($2)) AS waiting',[blockerPid,context.pid])).rows[0].waiting;}
     assert.equal(waiting,true,kind+' issuer must actually wait behind occupancy before expiry');
     await blocker.query('SELECT pg_sleep(2.1)');await blocker.query('COMMIT');
     const result=await pending;await db.query('ROLLBACK TO SAVEPOINT expiry_wait');await db.query('RELEASE SAVEPOINT expiry_wait');assert.equal(result.message,'AUTH_REQUIRED',kind+' issuer expired during observed occupancy wait');
     await db.query('RESET ROLE');
     assert.equal((await db.query('SELECT event_sequence::text AS sequence FROM food_shipments WHERE id=$1',[ship])).rows[0].sequence,eventsBefore);
     assert.equal((await db.query('SELECT count(*)::int AS n FROM fulfillment_proofs WHERE assignment_id=$1 AND secret_hash=$2',[claimed.assignmentId,args[4]])).rows[0].n,0);
     assert.equal((await db.query('SELECT (SELECT count(*) FROM food_dispatch_commands WHERE idempotency_key=$1)+(SELECT count(*) FROM food_merchant_commands WHERE idempotency_key=$1) AS n',[args[3]])).rows[0].n,'0');
     if(kind==='PICKUP')await db.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1",[staff]);
     else await db.query("UPDATE mobile_sessions SET access_expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",[dispatcherSession]);
     await db.query('SET LOCAL ROLE bitpos_app');passed.push(kind+' issuance refuses a session that expires during observed two-connection occupancy lock wait');
    }finally{await blocker.query('ROLLBACK');await blocker.end();}
   }
   await issuerExpiryWait('PICKUP',issueSql,[...issueArgs.slice(0,3),randomUUID(),secret,staff]);
   let pickup=(await db.query(issueSql,issueArgs)).rows[0].value;
   const replayIssued=(await db.query(issueSql,[...issueArgs.slice(0,4),hash(randomUUID()),staff])).rows[0].value;assert.equal(replayIssued.proofId,pickup.proofId);assert.equal(replayIssued.secretRecoveryRequired,true);assert.equal(replayIssued.replayed,true);
   const merchantRecovery=(await db.query('SELECT dispatch_merchant_issue_proof($1,$2,$3,$4,$5,$6,false,$7) AS value',[order.id,claimed.assignmentId,claimed.generation,claimed.leaseGeneration,issueKey,hash(randomUUID()),staff])).rows[0].value;assert.equal(merchantRecovery.proofId,pickup.proofId);assert.equal(merchantRecovery.secretRecoveryRequired,true);
   await denied('A new issue key cannot silently rotate live pickup proof','P0001',()=>db.query(issueSql,[...issueArgs.slice(0,3),randomUUID(),hash(randomUUID()),staff]));
   const retiredProof=pickup.proofId,retiredSecret=secret;secret=hash(randomUUID());
   pickup=(await db.query("SELECT dispatch_issue_proof($1,'PICKUP',$2,$3,$4,$5,true,$6) AS value",[claimed.assignmentId,claimed.generation,claimed.leaseGeneration,randomUUID(),secret,staff])).rows[0].value;assert.notEqual(pickup.proofId,retiredProof);
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[driverAccount,driverSession]);
   const consume=[claimed.assignmentId,pickup.proofId,claimed.generation,claimed.leaseGeneration,randomUUID(),secret],consumeSql='SELECT dispatch_consume_proof($1,$2,$3,$4,$5,$6) AS value';
   await denied('Explicit proof rotation makes old secret unusable','P0001',()=>db.query(consumeSql,[claimed.assignmentId,retiredProof,claimed.generation,claimed.leaseGeneration,randomUUID(),retiredSecret]));
   const incorrect=[...consume.slice(0,4),randomUUID(),hash(randomUUID())],wrong=(await db.query(consumeSql,incorrect)).rows[0].value;assert.equal(wrong.accepted,false);assert.equal(wrong.attemptsRemaining,9);assert.deepEqual((await db.query(consumeSql,incorrect)).rows[0].value,wrong);
   await denied('Stale lease cannot consume correct pickup proof','P0001',()=>db.query(consumeSql,[...consume.slice(0,3),String(BigInt(claimed.leaseGeneration)+1n),randomUUID(),secret]));
   passed.push('Incorrect proof attempt persists a replay-safe refusal; stale lease cannot consume correct secret');
   const picked=(await db.query(consumeSql,consume)).rows[0].value;assert.equal(picked.accepted,true);assert.deepEqual((await db.query(consumeSql,consume)).rows[0].value,picked);
   await db.query('SELECT dispatch_food_arrive($1,$2::jsonb)',[claimed.assignmentId,JSON.stringify({idempotencyKey:randomUUID(),generation:claimed.generation,leaseGeneration:claimed.leaseGeneration,stage:'DROPOFF'})]);
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[account,dispatcherSession]);
   await issuerExpiryWait('DELIVERY',"SELECT dispatch_issue_proof($1,'DELIVERY',$2,$3,$4,$5)",[claimed.assignmentId,claimed.generation,claimed.leaseGeneration,randomUUID(),hash(randomUUID())]);
   const deliverySecret=hash(randomUUID()),deliveryProof=(await db.query("SELECT dispatch_issue_proof($1,'DELIVERY',$2,$3,$4,$5) AS value",[claimed.assignmentId,claimed.generation,claimed.leaseGeneration,randomUUID(),deliverySecret])).rows[0].value;
   await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[driverAccount,driverSession]);
   const delivered=(await db.query(consumeSql,[claimed.assignmentId,deliveryProof.proofId,claimed.generation,claimed.leaseGeneration,randomUUID(),deliverySecret])).rows[0].value;assert.equal(delivered.accepted,true);
   await db.query('SET CONSTRAINTS ALL IMMEDIATE');await db.query('RESET ROLE');
   assert.equal((await db.query('SELECT state FROM food_shipments WHERE id=$1',[ship])).rows[0].state,'DELIVERED');
   assert.equal((await db.query('SELECT count(*)::int AS n FROM earning_accruals WHERE food_assignment_id=$1',[claimed.assignmentId])).rows[0].n,1);
   const lease=(await db.query('SELECT state FROM driver_assignment_leases WHERE id=(SELECT lease_id FROM food_assignments WHERE id=$1)',[claimed.assignmentId])).rows[0];assert.equal(lease.state,'RELEASED');
   const expectedEarning=(await db.query('SELECT driver_minor::text AS minor FROM quote_delivery_snapshots WHERE merchant_id=$1 AND quote_id=$2',[merchant,q.id])).rows[0].minor;
   const facts=(await db.query('SELECT f.amount_minor::text AS minor FROM earning_accruals a JOIN earning_accrual_facts f ON f.accrual_id=a.id WHERE a.food_assignment_id=$1',[claimed.assignmentId])).rows[0];assert.equal(facts.minor,expectedEarning);
   const balanced=(await db.query('SELECT sum(e.debit_minor)::text AS debit,sum(e.credit_minor)::text AS credit FROM earning_accruals a JOIN ledger_entries e ON e.transaction_id=a.ledger_transaction_id WHERE a.food_assignment_id=$1',[claimed.assignmentId])).rows[0];assert.deepEqual(balanced,{debit:expectedEarning,credit:expectedEarning});
   await denied('Finalized allocation cannot acquire an extra fee liability','23514',()=>db.query("INSERT INTO order_allocations(merchant_id,order_id,line_id,party_kind,party_id,kind,currency,decimals,amount_minor,source_quote_id) VALUES($1,$2,'@fees','DRIVER',$3,'SERVICE','USD',2,1,$4)",[merchant,order.id,randomUUID(),q.id]));
   passed.push('Merchant collection bypass denied; driver proof pickup replay and customer-issued delivery proof close lease with one durable earning obligation');
   await db.query('SET LOCAL ROLE bitpos_app');await db.query("SELECT set_config('bitpos.mobile_account',$1,true),set_config('bitpos.mobile_session',$2,true)",[account,dispatcherSession]);
   assert.deepEqual(FoodDriverWorkSchema.parse((await db.query('SELECT dispatch_driver_work() AS value')).rows[0].value),{offers:[],assignment:null});
   assert.deepEqual((await db.query('SELECT dispatch_food_tracking($1) AS value',[ship])).rows[0].value,{assignmentId:null,location:null});
   passed.push('Closed lease no longer exposes historical location to owner; non-driver owner has no driver work');
  }
 }
 const privateDetail=await orderView(client,order),privateList=(await orderViews(client,[order]))[0];
 assert.equal(privateDetail.delivery?.addressId,address);assert.equal(privateDetail.delivery?.deliveryFee.amountMinor,'100');
 assert.deepEqual(privateList.delivery,privateDetail.delivery);passed.push('Merchant detail and polled list retain the same frozen delivery destination and fees');
 assert.equal('delivery' in await orderView(client,order,true),false);assert.equal('delivery' in (await orderViews(client,[order],true))[0],false);passed.push('Public payment detail and list omit delivery contact and destination');
 await db.query('SET CONSTRAINTS ALL DEFERRED');
 const pickup=await captureQuote(client,merchant,origin,items,{...authority,serving:{kind:'pickup',label:'Fixture pickup'}},customer);
 assert.equal(pickup.total_minor,'270');await validateQuote(client,merchant,pickup);
 const pickupOrder=await createQuotedOrder(client,merchant,{quote:pickup,customerId:customer,idempotencyKey:randomUUID(),requestHash:'fixture-pickup',screenGeneration:null});
 await db.query('SET CONSTRAINTS ALL IMMEDIATE');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM food_shipments WHERE merchant_id=$1 AND order_id=$2',[merchant,pickupOrder.id])).rows[0].n,0);
 await denied('Pickup cannot acquire fabricated delivered shipment','23514',()=>db.query("INSERT INTO food_shipments(merchant_id,order_id,quote_id,account_id,state) VALUES($1,$2,$3,$4,'DELIVERED')",[merchant,pickupOrder.id,q.id,account]));
 for(const [name,patch] of [
  ['Unrelated quote',{quote_id:pickup.id}],['Wrong customer',{account_id:randomUUID()}],
  ['Fabricated delivered state',{state:'DELIVERED'}],['Fabricated dispatch state',{state:'READY_FOR_DISPATCH'}],
  ['Noninitial version',{version:2}],['Noninitial generation',{generation:1}],['Noninitial event counter',{event_sequence:1}],['Fabricated assignment pointer',{active_assignment_id:randomUUID()}],
 ] as const)await denied(name+' cannot enter shipment admission','23514',()=>db.query("INSERT INTO food_shipments SELECT (jsonb_populate_record(NULL::food_shipments,to_jsonb(s)||$3::jsonb||jsonb_build_object('id',$4::uuid))).* FROM food_shipments s WHERE merchant_id=$1 AND order_id=$2",[merchant,order.id,JSON.stringify(patch),randomUUID()]));
 await denied('Committed pickup quote cannot acquire delivery sidecar','23514',()=>db.query("INSERT INTO quote_delivery_snapshots SELECT (jsonb_populate_record(NULL::quote_delivery_snapshots,to_jsonb(d)||jsonb_build_object('quote_id',$3::uuid))).* FROM quote_delivery_snapshots d WHERE merchant_id=$1 AND quote_id=$2",[merchant,q.id,pickup.id]));
 passed.push('Unchanged pickup authority keeps 270 total and creates no delivery shipment');
 const expiryRun=process.argv.includes('--issuer-expiry');
 const receipt={status:'PASS',passed,rollback:!expiryRun,database:fixtureDatabase,fixtureMerchantId:merchant,fixtureOrderId:order.id,role:'bitpos_app for quote, canonical order and dispatch commands',limits:[expiryRun?'Isolated schema-only disposable database: synthetic seed, migrations and pickup committed to make actual lock waits observable across connections; final transaction rolled back. Not production or API/AVD acceptance.':process.argv.includes('--custody')?'Synthetic SQL-only verifier seam, not chain payment. Rollback custody, earning obligations and canonical allocation guard only; HTTP/AVD integration and payouts not accepted.':process.argv.includes('--dispatch')?'Synthetic SQL-only verifier seam, not chain payment; offer/claim/arrival and private location only; custody/earnings not exercised':'Local transactional fixture; API/AVD not exercised by this smoke'],physicalTesting:'deferred_by_user_2026-10-16'};
 console.log(JSON.stringify(receipt));
 if(!ownFixture)await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+(expiryRun?'dispatch063-issuer-expiry-smoke-20261018.json':process.argv.includes('--custody')?'dispatch063-custody-earning-smoke-20261018.json':process.argv.includes('--dispatch')?'dispatch061-canonical-lifecycle-smoke-20261018.json':'delivery060-admission-smoke-20261018.json'),JSON.stringify(receipt,null,2)+'\n');
}catch(error){if(!(error instanceof Error&&error.message==='JOINED_RACE_COMPLETE'))throw error;}
finally{await db.query('ROLLBACK').catch(()=>undefined);await db.end();await pool.end();}

async function waitForLock(client:pg.Client,queryPattern:string){
 for(let i=0;i<200;i++){
  await client.query('SELECT pg_stat_clear_snapshot()');
  const n=(await client.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1",['%'+queryPattern])).rows[0].n;
  if(n)return;await new Promise(resolve=>setTimeout(resolve,10));
 }
 throw Error('Competing transaction did not reach the expected lock');
}
