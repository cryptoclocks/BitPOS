import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
import type {prepareRefund135ConfiguredFixture} from './refund135-configured-fixture';
process.env.DOTENV_CONFIG_PATH='/dev/null';
const fixtureDatabaseUrl=process.env.BITPOS_DELIVERY_FIXTURE_DATABASE_URL??'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture';
const fixtureAppDatabaseUrl=process.env.BITPOS_DELIVERY_FIXTURE_APP_DATABASE_URL??fixtureDatabaseUrl.replace('cryptoclock@','bitpos_app@');
Object.assign(process.env,{DATABASE_URL:fixtureAppDatabaseUrl,ADMIN_DATABASE_URL:fixtureDatabaseUrl,AUTH_URL:process.env.BITPOS_FIXTURE_AUTH_URL??'http://127.0.0.1:55437',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {hash,MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {fixturePaymentAttempt}=await import('../../tests/backend-payment-fixture');
const {settleAttempt}=await import('../../apps/api/src/orders');
const {pool}=await import('../../apps/api/src/db');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
const searchStage=process.argv.includes('--search-stage'),navigationStage=process.argv.includes('--navigation-stage'),avdStage=process.argv.includes('--avd-stage')||navigationStage;
const currentE2e=process.argv.includes('--current-e2e');
const refundWalletFixture=process.argv.includes('--refund-wallet-fixture'),refundWalletPayer=refundWalletFixture?(await import('@solana/web3.js')).Keypair.generate().publicKey.toBase58():undefined;
const configuredRefundFixture=process.argv.includes('--refund-configured-fixture');
let configuredFixture:Awaited<ReturnType<typeof prepareRefund135ConfiguredFixture>>|undefined;
assert.ok(!configuredRefundFixture||refundWalletFixture,'Configured refund fixture requires --refund-wallet-fixture');
const otpDriver=avdStage||process.argv.includes('--settlement088-beneficiary-avd');
const base=process.env.BITPOS_DISPATCH_FIXTURE_BASE??'http://127.0.0.1:3003',mobile='/api/mobile/v1',merchant=randomUUID(),foreignMerchant=randomUUID(),branch=randomUUID(),product=randomUUID(),policy=randomUUID(),grant=randomUUID(),staffUser='fa000000-0000-4000-8000-000000000010';let driver=randomUUID();
const passed:string[]=[],seedSessions:string[]=[];let customerToken='',merchantToken='',otherMerchantToken='',orderId='';
let keepJoinedFixture=false;
async function call(path:string,method='GET',body?:unknown,token?:string,status=200,signal?:AbortSignal){const response=await fetch(base+path,{method,signal,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,status,method+' '+path+' response status');if(status>=400){assert.equal(typeof value.error?.code,'string');return value.error;}return value;}
async function seedActor(){const account=randomUUID(),session=randomUUID(),device=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url');await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,account,device,hash(access),hash(refresh)]);await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',[hash(refresh),session]);seedSessions.push(session);return {account,session,device,access,refresh};}
try{
 const fixtureTarget=new URL(fixtureDatabaseUrl);
 assert.ok(fixtureTarget.hostname==='127.0.0.1'&&((fixtureTarget.pathname==='/bitpos_delivery_fixture'&&['55436','55440'].includes(fixtureTarget.port))||(fixtureTarget.pathname==='/bitpos_w01_fixture'&&fixtureTarget.port==='55446')),'Only named local disposable fixture allowed');
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,fixtureTarget.pathname.slice(1));
 // Domain-recovery proof uses disposable seeded identity, not another OTP/provider acceptance.
 const customer=process.argv.some(arg=>['--incident-authority-sql','--assignment-recovery-sql','--assignment-recovery-http','--assignment-recovery-refresh','--assignment-recovery-pickup-race','--assignment-recovery-avd','--fixture-customer-seeded'].includes(arg))?await (async()=>{const seeded=await seedActor();return {accountId:seeded.account,accessToken:seeded.access,refreshToken:seeded.refresh};})():await call(mobile+'/auth/verify','POST',{phone:'+66900000001',code:'123456',deviceId:randomUUID()});customerToken=customer.accessToken;
 await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
 await db.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'DISPATCH066 HTTP SYNTHETIC FIXTURE','11111111111111111111111111111111')",[merchant]);
 await db.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'DISPATCH066 FOREIGN TENANT FIXTURE','11111111111111111111111111111111')",[foreignMerchant]);await db.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[staffUser,foreignMerchant]);
 await db.query("INSERT INTO marketplace_branches(merchant_id,id,name,enabled,delivery_enabled) VALUES($1,$2,'Synthetic dispatch branch',true,true)",[merchant,branch]);
 await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'อาหารทดสอบ','Synthetic food','',270,$3)",[product,merchant,configuredRefundFixture?10:5]);
 await publishPrices(db as unknown as pg.PoolClient,merchant,staffUser,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'HTTP SYNTHETIC FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 const price=(await db.query('SELECT active_price_version_id FROM merchant_pricing WHERE merchant_id=$1',[merchant])).rows[0].active_price_version_id;
 if(configuredRefundFixture)configuredFixture=await (await import('./refund135-configured-fixture')).prepareRefund135ConfiguredFixture(db,merchant,staffUser,product,price);
 await db.query("INSERT INTO delivery_policy_versions(merchant_id,branch_id,id,price_version_id,currency,decimals,name,origin_latitude_e7,origin_longitude_e7,south_e7,north_e7,west_e7,east_e7,delivery_minor,service_minor,merchant_minor,driver_minor,platform_minor,published_by,fixture) VALUES($1,$2,$3,$4,'USD',2,'SYNTHETIC HTTP FIXTURE',137560000,1005018000,137000000,138000000,1004000000,1006000000,100,20,0,100,20,$5,true)",[merchant,branch,policy,price,customer.accountId]);
 await db.query('INSERT INTO branch_delivery_policies VALUES($1,$2,1,$3,true)',[merchant,branch,policy]);await db.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[staffUser,merchant]);
 const dispatcher=await seedActor(),driverActor=otpDriver?await (async()=>{const device=randomUUID(),login=await call(mobile+'/auth/verify','POST',{phone:process.argv.includes('--settlement088-beneficiary-avd')?'+66900000001':'+66900000002',code:'123456',deviceId:device});return {account:login.accountId,session:login.sessionId,device,access:login.accessToken,refresh:login.refreshToken};})():await seedActor(),outsider=await seedActor();
 const existingDriver=otpDriver?(await db.query('SELECT id FROM bitpos.driver_profiles WHERE account_id=$1',[driverActor.account])).rows[0]:null;if(existingDriver)driver=existingDriver.id;
 await db.query("INSERT INTO platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,'dispatcher','Synthetic HTTP fixture',clock_timestamp()+interval '1 hour')",[grant,dispatcher.account]);await db.query('INSERT INTO platform_role_scopes VALUES($1,$2)',[grant,merchant]);
 if(!existingDriver){
 await db.query("INSERT INTO driver_profiles(id,account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,$2,'Synthetic HTTP driver',clock_timestamp()+interval '2 days','APPROVED',clock_timestamp()+interval '1 day',$3,'Synthetic document fixture, not real KYC')",[driver,driverActor.account,dispatcher.account]);
 await db.query("INSERT INTO driver_vehicles VALUES($1,'MOTORCYCLE','FIXTURE','Fixture','Purple',clock_timestamp()+interval '1 day')",[driver]);await db.query('INSERT INTO driver_occupancy(driver_id) VALUES($1)',[driver]);}
 await db.query("INSERT INTO driver_availability(driver_id,requested_online,heartbeat_expires_at) VALUES($1,true,clock_timestamp()+interval '90 seconds') ON CONFLICT(driver_id) DO UPDATE SET requested_online=true,heartbeat_expires_at=excluded.heartbeat_expires_at",[driver]);await db.query('COMMIT');
 merchantToken=(await call('/api/session','POST',{email:'merchant@bitpos.invalid',password:'local-fixture-only',merchantId:merchant})).token;
 otherMerchantToken=(await call('/api/session','POST',{email:'merchant@bitpos.invalid',password:'local-fixture-only',merchantId:foreignMerchant})).token;
 if(process.argv.includes('--joined-ui-prepare')){
 const {prepareJoinedFoodUi}=await import('./food-joined-ui-smoke');
 await prepareJoinedFoodUi({db,call,base,merchant,branch,product,policy,driver,grant,customerToken,customerRefresh:customer.refreshToken,driverActor,dispatcher,merchantToken});keepJoinedFixture=true;
 }else if(process.argv.includes('--pickup-current')){
 const {verifyPickupCurrent}=await import('./food-pickup-current-smoke');
 let attemptId:string|undefined;
 await verifyPickupCurrent({db,call,merchant,branch,product,customerToken,merchantToken,otherMerchantToken,settle:async id=>{
  await db.query('BEGIN');try{await db.query('SET LOCAL search_path=bitpos,public');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
  const attempt=attemptId?(await db.query('SELECT * FROM payment_attempts WHERE id=$1',[attemptId])).rows[0]:(await fixturePaymentAttempt(db,{merchant,order:id,status:'SUBMITTED',signature:'PICKUP-SQL-FIXTURE-'+randomUUID()})).rows[0];attemptId=attempt.id;await settleAttempt(db as unknown as pg.PoolClient,attempt,true);await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}
 }});
 }else{
 const addresses=await call(mobile+'/account/addresses',undefined,undefined,customerToken);let address=addresses.addresses.find((a:{archived:boolean;address:{latitudeE7:number|null}})=>!a.archived&&a.address.latitudeE7===137560001);
 if(!address)address=await call(mobile+'/account/addresses','POST',{idempotencyKey:randomUUID(),address:{label:'Synthetic dispatch',recipientName:'Fixture recipient',phone:'+66900000001',addressText:'Synthetic destination',instructions:'Synthetic fixture, no real delivery',latitudeE7:137560001,longitudeE7:1005018001}},customerToken);
 const quote=await call(mobile+'/food/quotes','POST',{branchId:branch,serving:'delivery',items:configuredFixture?.items??[{lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}],delivery:{addressId:address.id,addressVersion:address.version,policyVersionId:policy}},customerToken);assert.equal(quote.total.amountMinor,configuredFixture?.catalogTotal??'390');
 const submit={branchId:branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()},orders=await Promise.all([call(mobile+'/food/orders','POST',submit,customerToken),call(mobile+'/food/orders','POST',submit,customerToken)]);assert.equal(orders[0].order.id,orders[1].order.id);orderId=orders[0].order.id;passed.push('Authenticated canonical delivery quote'+quote.total.amountMinor+' and concurrent order retry admit one persisted order');
 const work=await call('/api/orders/'+orderId+'/delivery','GET',undefined,merchantToken),ship=work.shipmentId,offerPath=mobile+'/platform/food/shipments/'+ship+'/offers';
 await call('/api/orders/'+orderId+'/delivery','GET',undefined,otherMerchantToken,404);await call(mobile+'/orders/'+orderId+'/delivery','GET',undefined,customerToken,404);
 assert.equal((await call(offerPath,'POST',{idempotencyKey:randomUUID(),expectedVersion:work.version,driverId:driver},dispatcher.access,409)).code,'DISPATCH_NOT_READY');
 await call('/api/orders/'+orderId+'/acceptance','POST',{status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23},merchantToken);
 await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const attempt=(await fixturePaymentAttempt(db as unknown as pg.PoolClient,{merchant,order:orderId,status:'SUBMITTED',signature:'HTTP-SYNTHETIC-VERIFIER-'+randomUUID(),payer:refundWalletPayer})).rows[0];await settleAttempt(db as unknown as pg.PoolClient,attempt,true);await db.query('COMMIT');
 await call('/api/orders/'+orderId+'/fulfillment','POST',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()},merchantToken);await call('/api/orders/'+orderId+'/fulfillment','POST',{status:'READY',expectedVersion:1,idempotencyKey:randomUUID()},merchantToken);
 assert.equal((await call('/api/orders/'+orderId+'/fulfillment','POST',{status:'COLLECTED',expectedVersion:2,idempotencyKey:randomUUID()},merchantToken,409)).code,'DRIVER_PICKUP_PROOF_REQUIRED');
 if(!process.argv.includes('--automatic-claim-car')&&!process.argv.includes('--automatic-claim-lock'))await call(mobile+`/platform/merchants/${merchant}/branches/${branch}/drivers/${driver}/food-service`,'PUT',{idempotencyKey:randomUUID(),expectedVersion:'0',enabled:true,validUntil:new Date(Date.now()+1800000).toISOString(),reason:'Synthetic078 explicit FOOD service authority for canonical fixture'},dispatcher.access);
 if(process.argv.includes('--search-boundary')){
 const {verifyFoodSearchBoundary}=await import('./food-search-boundary-smoke');
 await verifyFoodSearchBoundary({db,shipment:ship,merchant,branch,driver,dispatcher,call,unavailable:process.argv.includes('--provider-unavailable')});
 }else if(process.argv.includes('--push-automatic-offer')){
  const {verifyMobilePushOffer}=await import('./mobile-push-offer-smoke');
  await verifyMobilePushOffer({db,shipment:ship,merchant,branch,driver,driverActor,dispatcher,call});
 }else if(process.argv.includes('--customer-work-refresh')){
  const {verifyFoodCustomerWorkRefresh}=await import('./food-customer-work-refresh-smoke');
  await verifyFoodCustomerWorkRefresh({db,base,shipment:ship,orderId,accountId:customer.accountId,access:customerToken,call,onRotated:access=>{customerToken=access;}});
 }else if(process.argv.includes('--dispatch-console-http')){
  const {verifyFoodDispatchConsoleHttp}=await import('./food-dispatch-console-http-smoke');
  await verifyFoodDispatchConsoleHttp({db,base,merchant,foreignMerchant,branch,product,policy,grant,shipment:ship,address,customerToken,dispatcher,outsider,call});
 }else if(process.argv.includes('--dispatch-console-stage')){
  const {stageFoodDispatchConsole}=await import('./food-dispatch-console-stage');
  await stageFoodDispatchConsole(db,{merchant,branch,shipmentId:ship,orderId,driverId:driver});
 }else if(process.argv.includes('--offer-avd')){
  const {runFoodOfferAvd}=await import('./food-offer-avd-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[driverActor.account,hash(driverActor.access)])).rows[0].id;
  await runFoodOfferAvd({db,base,shipment:ship,driver,dispatcher,driverActor:{...driverActor,session},call});
 }else if(process.argv.includes('--offer-lifecycle')){
  const {runFoodOfferLifecycle}=await import('./food-offer-lifecycle-smoke');
  await runFoodOfferLifecycle({db,base,merchant,branch,shipment:ship,driver,dispatcher,driverActor,outsider,call});
 }else if(process.argv.includes('--automatic-claim-car')||process.argv.includes('--automatic-claim-lock')){
  const {runAutomaticClaimReview}=await import('./food-ranking-claim-review-smoke');
  await runAutomaticClaimReview({db,base,merchant,branch,shipment:ship,driver,grant,dispatcher,driverActor,call,mode:process.argv.includes('--automatic-claim-car')?'car':'lock',fixed:process.argv.includes('--expect-fixed')});
 }else if(searchStage){
  const policyPath=mobile+`/platform/merchants/${merchant}/branches/${branch}/food-dispatch-policy`,searchPath=mobile+`/platform/food/shipments/${ship}/search`;
  const policyCommand={idempotencyKey:randomUUID(),expectedVersion:'0',enabled:true,vehicleType:'MOTORCYCLE',offerBudget:2,cycleSeconds:60,overallSeconds:300,maxCycles:3,shortlistSize:4,maxPickupSeconds:600,validUntil:new Date(Date.now()+86400000).toISOString(),reason:'Synthetic joined search HTTP fixture'};
  const published=await call(policyPath,'PUT',policyCommand,dispatcher.access);assert.equal((await call(searchPath,'GET',undefined,dispatcher.access)).search,null);
  await call(searchPath,'GET',undefined,outsider.access,403);await call(searchPath,'PUT',{idempotencyKey:randomUUID(),expectedVersion:'0',action:'START',reason:'No staff scope'},outsider.access,403);
  const startCommand={idempotencyKey:randomUUID(),expectedVersion:'0',action:'START',reason:'Synthetic joined search start'},starts=await Promise.all([call(searchPath,'PUT',startCommand,dispatcher.access),call(searchPath,'PUT',startCommand,dispatcher.access)]);assert.deepEqual(starts[0],starts[1]);assert.equal(starts[0].policyId,published.policyId);
  const first=starts[0];await call(searchPath,'PUT',{...startCommand,reason:'Tampered retry'},dispatcher.access,409);await call(searchPath+'?merchantId='+foreignMerchant,'GET',undefined,dispatcher.access,422);
  const manual=await call(searchPath,'PUT',{idempotencyKey:randomUUID(),expectedVersion:first.version,action:'MANUAL',reason:'Synthetic operator takes manual search control'},dispatcher.access);assert.equal(manual.mode,'MANUAL');
  const retry=await call(searchPath,'PUT',{idempotencyKey:randomUUID(),expectedVersion:manual.version,action:'RETRY',reason:'Synthetic bounded second search cycle'},dispatcher.access);assert.equal(retry.cycleNumber,2);assert.equal(retry.absoluteDeadline,first.absoluteDeadline);assert.equal(retry.cycles.length,2);
  assert.deepEqual((await call(searchPath,'GET',undefined,dispatcher.access)).search,retry);
  const counterpart=(await db.query('SELECT s.version::text,s.epoch::text,s.cycle_number,s.offers_remaining,s.absolute_deadline,(SELECT count(*)::int FROM bitpos.food_dispatch_search_cycles c WHERE c.shipment_id=s.shipment_id) cycles,(SELECT count(*)::int FROM bitpos.food_dispatch_offers f WHERE f.shipment_id=s.shipment_id) offers,(SELECT count(*)::int FROM bitpos.food_assignments a WHERE a.shipment_id=s.shipment_id) assignments FROM bitpos.food_dispatch_searches s WHERE s.shipment_id=$1',[ship])).rows[0];assert.equal(counterpart.version,retry.version);assert.equal(counterpart.epoch,retry.epoch);assert.equal(counterpart.cycle_number,2);assert.equal(counterpart.cycles,2);assert.equal(counterpart.offers_remaining,2);assert.equal(counterpart.offers,0);assert.equal(counterpart.assignments,0);assert.equal(counterpart.absolute_deadline.toISOString(),new Date(first.absoluteDeadline).toISOString());
  passed.push('Actual canonical accepted/fixture-settled delivery→scoped policy→concurrent exact search start→manual→bounded retry→HTTP snapshot and committed cycle counterpart; zero offers or assignments');
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch074-search-http-20261018.json',JSON.stringify({status:'PASS_BOUNDED_SEARCH_HTTP_AND_PERSISTENCE',base,merchant,branch,orderId,shipmentId:ship,policyId:published.policyId,search:retry,counterpart,passed,fixtures:['Synthetic OTP/merchant/customer/driver/staff identities','SQL-only synthetic payment verifier, not chain proof'],limits:['Search authority only; no automatic road ranking/offers/operator UI or full071 acceptance','Synthetic staff grant revoked and driver offline in finally; retained search becomes policy-unavailable'],physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');console.log('PASS_BOUNDED_SEARCH_HTTP_AND_PERSISTENCE');
 }else{
 if(process.argv.includes('--recovery-search')){
  await call(mobile+`/platform/merchants/${merchant}/branches/${branch}/food-dispatch-policy`,'PUT',{idempotencyKey:randomUUID(),expectedVersion:'0',enabled:true,vehicleType:'MOTORCYCLE',offerBudget:2,cycleSeconds:60,overallSeconds:300,maxCycles:3,shortlistSize:4,maxPickupSeconds:600,validUntil:new Date(Date.now()+86400000).toISOString(),reason:'Synthetic080 search preservation fixture'},dispatcher.access);
  await call(mobile+`/platform/food/shipments/${ship}/search`,'PUT',{idempotencyKey:randomUUID(),expectedVersion:'0',action:'START',reason:'Synthetic080 original bounded search window'},dispatcher.access);
 }
 const manualPushBinding=process.argv.includes('--push-manual-offer')?await(await import('./mobile-push-manual-offer-smoke')).prepareManualPush({db,shipment:ship,driver,driverActor}):null;
 const offerCommand={idempotencyKey:randomUUID(),expectedVersion:work.version,driverId:driver},offers=await Promise.all([call(offerPath,'POST',offerCommand,dispatcher.access),call(offerPath,'POST',offerCommand,dispatcher.access)]);assert.deepEqual(offers[0],offers[1]);const offer=offers[0];
 const inbox=await call(mobile+'/driver/food/work','GET',undefined,driverActor.access);assert.equal(inbox.offers[0].id,offer.offerId);assert.equal('addressText' in inbox.offers[0],false);
 await call(mobile+'/driver/food/offers/'+offer.offerId+'/claim','POST',{idempotencyKey:randomUUID(),expectedVersion:'1',generation:offer.generation},outsider.access,404);
 if(manualPushBinding){
  const secondQuote=await call(mobile+'/food/quotes','POST',{branchId:branch,serving:'delivery',items:[{lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}],delivery:{addressId:address.id,addressVersion:address.version,policyVersionId:policy}},customerToken);
  const secondOrder=(await call(mobile+'/food/orders','POST',{branchId:branch,quoteId:secondQuote.id,priceVersion:secondQuote.priceVersion,idempotencyKey:randomUUID()},customerToken)).order.id;
  await call('/api/orders/'+secondOrder+'/acceptance','POST',{status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23},merchantToken);
  await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);const secondAttempt=(await fixturePaymentAttempt(db as unknown as pg.PoolClient,{merchant,order:secondOrder,status:'SUBMITTED',signature:'HTTP-SYNTHETIC-VERIFIER-'+randomUUID(),payer:refundWalletPayer})).rows[0];await settleAttempt(db as unknown as pg.PoolClient,secondAttempt,true);await db.query('COMMIT');
  await call('/api/orders/'+secondOrder+'/fulfillment','POST',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()},merchantToken);await call('/api/orders/'+secondOrder+'/fulfillment','POST',{status:'READY',expectedVersion:1,idempotencyKey:randomUUID()},merchantToken);
  const secondWork=await call('/api/orders/'+secondOrder+'/delivery','GET',undefined,merchantToken),secondOffer=await call(mobile+'/platform/food/shipments/'+secondWork.shipmentId+'/offers','POST',{idempotencyKey:randomUUID(),expectedVersion:secondWork.version,driverId:driver},dispatcher.access);
  await(await import('./mobile-push-manual-offer-smoke')).verifyManualPush({db,shipment:ship,driver,driverActor,bindingId:manualPushBinding,offerId:offer.offerId,occupy:async()=>{await call(mobile+'/driver/food/offers/'+secondOffer.offerId+'/claim','POST',{idempotencyKey:randomUUID(),expectedVersion:'1',generation:secondOffer.generation},driverActor.access);}});
 }else if(navigationStage){
  const assignment=await call(mobile+'/driver/food/offers/'+offer.offerId+'/claim','POST',{idempotencyKey:randomUUID(),expectedVersion:'1',generation:offer.generation},driverActor.access);
  await call(mobile+'/driver/food/assignments/'+assignment.assignmentId+'/location','POST',{generation:assignment.generation,leaseGeneration:assignment.leaseGeneration,sequence:'1',capturedAt:new Date().toISOString(),latitudeE7:137559000,longitudeE7:1005017000,accuracyMm:5000,headingMdeg:null,speedMmS:null},driverActor.access);
  const receipt={status:'FIXTURE_PREPARED_NOT_NAVIGATION_ACCEPTANCE',merchant,branch,orderId,shipmentId:ship,...assignment,driverPhone:'+66900000002',fixtures:['Synthetic OTP and approved documents','Synthetic SQL-only settlement, not chain proof','Injected location, not physical GPS'],physicalTesting:'deferred_by_user_2026-10-16'};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/navigation070-assigned-fixture-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }else if(avdStage){
  const receipt={status:'FIXTURE_PREPARED',merchant,branch,orderId,shipmentId:ship,offerId:offer.offerId,driverPhone:'+66900000002',fixtures:['Synthetic OTP123456 and approved documents, not real identity','Synthetic SQL-only settlement, not chain proof'],physicalTesting:'deferred_by_user_2026-10-16'};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch066-avd-fixture-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }else{
 const claimCommand={idempotencyKey:randomUUID(),expectedVersion:'1',generation:offer.generation},claims=await Promise.all([call(mobile+'/driver/food/offers/'+offer.offerId+'/claim','POST',claimCommand,driverActor.access),call(mobile+'/driver/food/offers/'+offer.offerId+'/claim','POST',claimCommand,driverActor.access)]);assert.deepEqual(claims[0],claims[1]);const assignment=claims[0],fence={generation:assignment.generation,leaseGeneration:assignment.leaseGeneration},assignmentPath=mobile+'/driver/food/assignments/'+assignment.assignmentId;
 if(process.argv.includes('--chat102-avd')||process.argv.includes('--chat103-read-avd')||process.argv.includes('--chat105-images-avd')||process.argv.includes('--chat105-gallery-avd')){
  const {runChat102Avd}=await import('./food-chat102-avd-smoke');
  await runChat102Avd({db,base,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,access:customerToken},driverActor});
 }
 if(process.argv.includes('--chat102-http')){
  const {verifyChat102Http}=await import('./food-chat102-http-smoke');
  await verifyChat102Http({db,base,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,access:customerToken},driverActor,outsider});
 }
 if(process.argv.includes('--chat103-read-http')){
  const {verifyChat103ReadHttp}=await import('./food-chat103-read-http-smoke');
  await verifyChat103ReadHttp({db,base,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,access:customerToken},driverActor,outsider});
 }
 if(process.argv.includes('--chat105-images-http')){
  const {verifyChat105ImagesHttp}=await import('./food-chat105-images-http-smoke');
  await verifyChat105ImagesHttp({db,base,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,access:customerToken},driverActor,outsider});
 }
 if(process.argv.includes('--chat104-upload-http')){
  const {verifyChat104UploadHttp}=await import('./food-chat104-upload-http-smoke');
  await verifyChat104UploadHttp({db,base,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,access:customerToken},driverActor,outsider});
 }
 if(process.argv.includes('--chat105-binding-sql')){
  const {verifyChat105Binding}=await import('./food-chat105-binding-sql-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyChat105Binding({db,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,session,access:customerToken},driverActor,outsider});
  const current=await call(mobile+'/driver/food/work','GET',undefined,driverActor.access);
  await call(assignmentPath+'/withdraw','POST',{idempotencyKey:randomUUID(),expectedVersion:current.assignment.shipmentVersion,...fence,reason:'SAFETY'},driverActor.access);
 }else if(process.argv.includes('--chat104-upload-sql')){
  const {verifyChat104Uploads}=await import('./food-chat104-upload-sql-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyChat104Uploads({db,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,session,access:customerToken},driverActor,outsider});
  const current=await call(mobile+'/driver/food/work','GET',undefined,driverActor.access);
  await call(assignmentPath+'/withdraw','POST',{idempotencyKey:randomUUID(),expectedVersion:current.assignment.shipmentVersion,...fence,reason:'SAFETY'},driverActor.access);
 }else if(process.argv.includes('--chat103-read-sql')){
  const {verifyChat103ReadSql}=await import('./food-chat103-read-sql-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyChat103ReadSql({db,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,session,access:customerToken},driverActor,outsider});
  const current=await call(mobile+'/driver/food/work','GET',undefined,driverActor.access);
  await call(assignmentPath+'/withdraw','POST',{idempotencyKey:randomUUID(),expectedVersion:current.assignment.shipmentVersion,...fence,reason:'SAFETY'},driverActor.access);
 }else if(process.argv.includes('--chat102-real-schema')){
  const {verifyChat102RealSchema}=await import('./food-chat102-real-schema-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyChat102RealSchema({db,assignmentId:assignment.assignmentId,driverId:driver,merchant,customer:{account:customer.accountId,session,access:customerToken},driverActor,outsider});
  const current=await call(mobile+'/driver/food/work','GET',undefined,driverActor.access);
  await call(assignmentPath+'/withdraw','POST',{idempotencyKey:randomUUID(),expectedVersion:current.assignment.shipmentVersion,...fence,reason:'SAFETY'},driverActor.access);
 }else if(process.argv.includes('--push-finish-lock')){
  const {verifyMobilePushFinish}=await import('./mobile-push-finish-smoke');
  await verifyMobilePushFinish({db,shipment:ship,driver,assignment,driverActor});
 }else if(process.argv.includes('--push-worker')){
  const {verifyMobilePushWorker}=await import('./mobile-push-worker-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  customerToken=await verifyMobilePushWorker({db,shipment:ship,orderId,customer:{account:customer.accountId,session,access:customerToken,refresh:customer.refreshToken}});
 }else if(process.argv.includes('--push-domain-sql')){
  const {verifyMobilePushDomain}=await import('./mobile-push-domain-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyMobilePushDomain({db,shipment:ship,orderId,driver,assignment,driverActor,customer:{account:customer.accountId,session,access:customerToken}});
 }else if(process.argv.includes('--customer-progress-sql')){
  const {verifyFoodCustomerDispatchProgressSql}=await import('./food-customer-dispatch-progress-sql-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyFoodCustomerDispatchProgressSql({db,shipment:ship,orderId,product,branch,driver,assignment,dispatcher,driverActor,customer:{account:customer.accountId,session,access:customerToken},outsider});
 }else if(process.argv.includes('--customer-progress-avd')){
  const {runFoodCustomerProgressAvd}=await import('./food-customer-progress-avd-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await runFoodCustomerProgressAvd({db,base,shipment:ship,orderId,branch,merchant,product,assignment,dispatcher,customer:{account:customer.accountId,session,access:customerToken},call});
 }else if(process.argv.includes('--assignment-recovery-avd')){
  const {runFoodWithdrawalAvd}=await import('./food-withdrawal-avd-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[driverActor.account,hash(driverActor.access)])).rows[0].id;
  await runFoodWithdrawalAvd({db,base,assignment,driverActor:{...driverActor,session}});
 }else if(process.argv.includes('--incident-authority-avd')){
  const {runFoodIncidentAvd}=await import('./food-incident-avd-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[driverActor.account,hash(driverActor.access)])).rows[0].id;
  await runFoodIncidentAvd({db,base,orderId,assignment,driverActor:{...driverActor,session},dispatcher,merchantToken,call});
 }else if(process.argv.includes('--dispatch-console-sql')){
  const {verifyFoodDispatchConsoleSql}=await import('./food-dispatch-console-sql-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyFoodDispatchConsoleSql({db,shipment:ship,orderId,branch,dispatcher,customer:{account:customer.accountId,session,access:customerToken},outsider});
 }else if(process.argv.includes('--cancellation-review-fences')){
  const {verifyFoodCancellationReviewFences}=await import('./food-cancellation-review-fence-smoke');
  const active=(await db.query('SELECT id,device_id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0];
  const refresh=randomBytes(32).toString('base64url'),seededRefresh=await db.query("UPDATE bitpos.mobile_sessions SET refresh_hash=$2 WHERE id=$1 RETURNING id",[active.id,hash(refresh)]);
  assert.equal(seededRefresh.rowCount,1);await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',[hash(refresh),active.id]);
  customerToken=await verifyFoodCancellationReviewFences({db,base,shipment:ship,orderId,customer:{account:customer.accountId,session:active.id,device:active.device_id,access:customerToken,refresh},dispatcher,call,onRotated:access=>{customerToken=access;}});
 }else if(process.argv.includes('--cancellation-review-race')){
  const {verifyFoodCancellationReviewRace}=await import('./food-cancellation-review-race-smoke');
  await verifyFoodCancellationReviewRace({db,base,shipment:ship,orderId,assignment,customer:{access:customerToken},dispatcher,call});
 }else if(process.argv.includes('--cancellation-review-avd')){
  const {runFoodCancellationReviewAvd}=await import('./food-cancellation-review-avd-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await runFoodCancellationReviewAvd({db,base,shipment:ship,orderId,product,assignment,customer:{account:customer.accountId,session,access:customerToken},driverActor,dispatcher,merchantToken,call});
 }else if(process.argv.includes('--cancellation-review-http')){
  const {verifyFoodCancellationReviewHttp}=await import('./food-cancellation-review-http-smoke');
  await verifyFoodCancellationReviewHttp({db,shipment:ship,orderId,product,assignment,customer:{access:customerToken},driverActor,dispatcher,outsider,merchantToken,call,postpickup:process.argv.includes('--postpickup')});
 }else if(process.argv.includes('--cancellation-review-sql')){
  const {verifyFoodCancellationReviewSql}=await import('./food-cancellation-review-sql-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyFoodCancellationReviewSql({db,shipment:ship,orderId,product,assignment,customer:{account:customer.accountId,session,access:customerToken},driverActor,dispatcher,outsider,merchantToken,postpickup:process.argv.includes('--postpickup')});
 }else if(process.argv.includes('--incident-resume-race')){
  const {verifyFoodIncidentResumeRace}=await import('./food-incident-resume-race-smoke');
  await verifyFoodIncidentResumeRace({db,base,shipment:ship,assignment,driverActor,dispatcher,call,reportFirst:process.argv.includes('--report-first')});
 }else if(process.argv.includes('--incident-authority-fences')){
  const {verifyFoodIncidentFences}=await import('./food-incident-authority-fence-smoke');
  await verifyFoodIncidentFences({db,base,shipment:ship,assignment,driverActor,dispatcher,call});
 }else if(process.argv.includes('--incident-authority-race')){
  const {verifyFoodIncidentRace}=await import('./food-incident-race-smoke');
  await verifyFoodIncidentRace({db,base,shipment:ship,orderId,assignment,driverActor,merchantToken,call,reportFirst:process.argv.includes('--report-first'),withdraw:process.argv.includes('--withdraw')});
 }else if(refundWalletFixture){
  await call(assignmentPath+'/arrive','POST',{...fence,stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access);
  const proof=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',{assignmentId:assignment.assignmentId,...fence,idempotencyKey:randomUUID(),rotate:false},merchantToken);
  const picked=await call(assignmentPath+'/consume-proof','POST',{...fence,proofId:proof.proofId,secret:proof.secret,idempotencyKey:randomUUID()},driverActor.access);assert.equal(picked.accepted,true);
  const incident=await call(assignmentPath+'/incidents','POST',{...fence,idempotencyKey:randomUUID(),kind:'CUSTODY',body:'Synthetic new wallet-payer fixture: return coordination required'},driverActor.access);assert.equal(incident.paused,true);
  const facts=(await db.query("SELECT a.state,l.state lease,i.blocks_duty,p.amount_minor::text amount,pa.payer FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id JOIN bitpos.food_assignment_incidents i ON i.assignment_id=a.id JOIN bitpos.payments p ON p.order_id=s.order_id JOIN bitpos.payment_attempt_assets pa ON pa.attempt_id=p.attempt_id WHERE a.id=$1",[assignment.assignmentId])).rows;assert.equal(facts.length,1);assert.equal(facts[0].payer,refundWalletPayer);assert.equal(facts[0].state,'PICKED_UP');assert.equal(facts[0].lease,'ACTIVE');assert.equal(facts[0].blocks_duty,true);
  const configured=configuredFixture?await (await import('./refund135-configured-fixture')).verifyRefund135ConfiguredOrder(db,merchant,orderId,configuredFixture):undefined;
  const fixtureEvidence='.omp/work/flutter-delivery-20261016/evidence/'+(configured?'w02-refund135-configured-fixture-'+new Date().toISOString().replaceAll(':','-')+'.json':'w02-refund-wallet-fixture-20261021.json');
  await writeFile(fixtureEvidence,JSON.stringify({status:'PASS_FRESH_CANONICAL_ORDER_PAYMENT_WALLET_SHAPE_FIXTURE',checkedAtUtc:new Date().toISOString(),assignmentId:assignment.assignmentId,orderId,merchant,branch,facts,...(configured?{configured}:{}),limits:['Fresh scoped customer quote/order, merchant acceptance, SQL-only synthetic settlement, actual pickup proof and custody report','Payer is new ephemeral valid public key, not proof of wallet ownership or real chain transfer','No existing immutable payment modified; no keys saved or real RPC/funds']},null,2)+'\n');console.log('PASS_FRESH_REFUND_WALLET_PAYER_FIXTURE '+fixtureEvidence);
 }else if(process.argv.includes('--delivery-issue-http')){
 const {verifyFoodIncidentAuthorityHttp}=await import('./food-incident-authority-http-smoke');
 await verifyFoodIncidentAuthorityHttp({db,shipment:ship,orderId,assignment,driverActor,dispatcher,outsider,merchantToken,call,postpickup:true,reportKind:'CUSTODY'});
 }else if(process.argv.includes('--incident-authority-http')){
  const {verifyFoodIncidentAuthorityHttp}=await import('./food-incident-authority-http-smoke');
  await verifyFoodIncidentAuthorityHttp({db,shipment:ship,orderId,assignment,driverActor,dispatcher,outsider,merchantToken,call,postpickup:process.argv.includes('--postpickup')});
 }else if(process.argv.includes('--incident-authority-sql')){
  const {verifyFoodIncidentAuthoritySql}=await import('./food-incident-authority-sql-smoke');
  await verifyFoodIncidentAuthoritySql({db,shipment:ship,assignment,driver,driverActor,dispatcher,outsider,merchantToken});
 }else if(process.argv.includes('--assignment-recovery-pickup-race')){
  const {verifyFoodPickupWithdrawalRace}=await import('./food-pickup-withdrawal-race-smoke');
  await verifyFoodPickupWithdrawalRace({db,base,shipment:ship,orderId,assignment,driverActor,merchantToken,call,pickupFirst:process.argv.includes('--pickup-first')});
 }else if(process.argv.includes('--assignment-recovery-refresh')){
  const {verifyFoodRecoveryRefreshRace}=await import('./food-recovery-refresh-race-smoke');
  await verifyFoodRecoveryRefreshRace({db,base,shipment:ship,assignment,driverActor,call});
 }else if(process.argv.includes('--delivery-issue-avd')){
 const {runFoodDeliveryIssueAvd}=await import('./food-delivery-issue-avd-smoke');
 await runFoodDeliveryIssueAvd({db,base,orderId,assignment,driverActor,merchantToken,call});
 }else if(process.argv.includes('--replacement-current')){
 const {verifyFoodReplacementCurrent}=await import('./food-replacement-current-smoke');
 await verifyFoodReplacementCurrent({db,shipment:ship,orderId,merchant,branch,assignment,driverActor,dispatcher,customerToken,merchantToken,call,seedActor});
 }else if(process.argv.includes('--assignment-recovery-http')){
  const current=await call(mobile+'/driver/food/work','GET',undefined,driverActor.access);
  let command={idempotencyKey:randomUUID(),expectedVersion:current.assignment.shipmentVersion,...fence,reason:'SAFETY'};
  await call(assignmentPath+'/withdraw','POST',command,outsider.access,404);
  await db.query("UPDATE bitpos.driver_profiles SET status='SUSPENDED',verified_until=NULL WHERE id=$1",[driver]);
  let receipts:any[];
  if(process.argv.includes('--distinct-withdrawal-race')){
   const commands=[command,{...command,idempotencyKey:randomUUID(),reason:'VEHICLE'}];
   const results=await Promise.all(commands.map(async(body)=>{const response=await fetch(base+assignmentPath+'/withdraw',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+driverActor.access},body:JSON.stringify(body)});return {status:response.status,value:await response.json(),command:body};}));
   assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=results.find(r=>r.status===200)!;assert.equal(results.find(r=>r.status===409)!.value.error.code,'VERSION_CONFLICT');
   command=winner.command;receipts=[winner.value,await call(assignmentPath+'/withdraw','POST',command,driverActor.access)];
  }else receipts=await Promise.all([call(assignmentPath+'/withdraw','POST',command,driverActor.access),call(assignmentPath+'/withdraw','POST',command,driverActor.access)]);
  assert.deepEqual(receipts[0],receipts[1]);assert.equal(receipts[0].state,'RELEASED');
  assert.equal((await call(assignmentPath+'/withdraw','POST',{...command,reason:'OTHER'},driverActor.access,409)).code,'IDEMPOTENCY_CONFLICT');
  const persisted=(await db.query("SELECT a.state,l.state lease,s.state shipment,s.active_assignment_id IS NULL unassigned,(SELECT count(*)::int FROM bitpos.food_dispatch_commands c WHERE c.actor_account_id=$2 AND c.idempotency_key=$3) commands FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id WHERE a.id=$1",[assignment.assignmentId,driverActor.account,command.idempotencyKey])).rows[0];
  assert.deepEqual(persisted,{state:'RELEASED',lease:'RELEASED',shipment:'READY_FOR_DISPATCH',unassigned:true,commands:1});
  const after=await call(mobile+'/driver/food/work','GET',undefined,driverActor.access);assert.equal(after.assignment,null);
  const receipt={status:process.argv.includes('--distinct-withdrawal-race')?'PASS_ACTUAL_HTTP_CONCURRENT_DISTINCT_WITHDRAWAL':'PASS_ACTUAL_HTTP_CONCURRENT_EXACT_WITHDRAWAL',base,assignmentId:assignment.assignmentId,receipt:receipts[0],persisted,fixture:true,limits:['Synthetic seeded identity/payment; not real payment','No080 AVD or full-platform acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};
  await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+(process.argv.includes('--distinct-withdrawal-race')?'dispatch080-withdrawal-distinct-http-20261018.json':'dispatch080-withdrawal-http-20261018.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }else if(process.argv.includes('--assignment-recovery-sql')){
  const {verifyFoodAssignmentRecoverySql}=await import('./food-assignment-recovery-sql-smoke');
 await verifyFoodAssignmentRecoverySql({db,shipment:ship,assignment,driver,driverActor,dispatcher,merchantToken});
 }else if(process.argv.includes('--customer-authority-expiry')){
  const {verifyFoodCustomerAuthorityExpiry}=await import('./food-customer-authority-expiry-smoke');
  await verifyFoodCustomerAuthorityExpiry({db,base,shipment:ship,driver,assignment,driverActor,merchantToken,customerToken,merchant,branch,orderId,call,expectFixed:process.argv.includes('--expect-fixed')});
 }else if(process.argv.includes('--driver-authority-avd')){
  const {runFoodAuthorityAvd}=await import('./food-authority-avd-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[driverActor.account,hash(driverActor.access)])).rows[0].id;
  await runFoodAuthorityAvd({db,base,shipment:ship,driver,assignment,dispatcher,driverActor:{...driverActor,session},merchantToken,orderId,call});
 }else if(process.argv.includes('--driver-authority')){
  const {verifyFoodDriverAuthority}=await import('./food-driver-authority-smoke');
  await verifyFoodDriverAuthority({db,shipment:ship,driver,assignment,driverActor,merchantToken,customerToken,merchant,branch,orderId,dispatcher,call});
 }else if(process.argv.includes('--driver-revocation')){
  const {reproduceFoodDriverRevocation}=await import('./food-driver-revocation-smoke');
  await reproduceFoodDriverRevocation({db,shipment:ship,driver,assignment,driverActor,call});
 }else{
 await call(assignmentPath+'/arrive','POST',{...fence,generation:'9223372036854775808',stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access,422);
 await call(assignmentPath+'/arrive','POST',{...fence,stage:'PICKUP',idempotencyKey:randomUUID()},driverActor.access);
 const location={...fence,sequence:'1',capturedAt:new Date().toISOString(),latitudeE7:137560001,longitudeE7:1005018001,accuracyMm:5000,headingMdeg:null,speedMmS:null},loc=await call(assignmentPath+'/location','POST',location,driverActor.access),locReplay=await call(assignmentPath+'/location','POST',location,driverActor.access);assert.equal(locReplay.receivedAt,loc.receivedAt);assert.equal(locReplay.replayed,true);
 await call(assignmentPath+'/location','POST',{...location,sequence:'2',leaseGeneration:String(BigInt(fence.leaseGeneration)+1n)},driverActor.access,409);await call(mobile+'/food/shipments/'+ship+'/tracking','GET',undefined,outsider.access,404);
 const tracking=await call(mobile+'/food/shipments/'+ship+'/tracking','GET',undefined,customerToken);assert.equal(tracking.assignment.location.sequence,'1');passed.push('Merchant acceptance/kitchen, paid synthetic verifier, concurrent scoped offer/claim and assignment-private HTTP location recover persisted state');
 const issue={assignmentId:assignment.assignmentId,...fence,idempotencyKey:randomUUID(),rotate:false},pickup=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',issue,merchantToken),pickupReplay=await call('/api/orders/'+orderId+'/delivery/pickup-proof','POST',issue,merchantToken);assert.equal(pickupReplay.proofId,pickup.proofId);assert.equal(pickupReplay.secret,null);assert.equal(pickupReplay.secretRecoveryRequired,true);
 const wrong={...fence,proofId:pickup.proofId,idempotencyKey:randomUUID(),secret:randomBytes(32).toString('base64url')},wrongReceipt=await call(assignmentPath+'/consume-proof','POST',wrong,driverActor.access);assert.equal(wrongReceipt.accepted,false);assert.deepEqual(await call(assignmentPath+'/consume-proof','POST',wrong,driverActor.access),wrongReceipt);
 const consume={...fence,proofId:pickup.proofId,idempotencyKey:randomUUID(),secret:pickup.secret},picked=await call(assignmentPath+'/consume-proof','POST',consume,driverActor.access);assert.equal(picked.accepted,true);assert.deepEqual(await call(assignmentPath+'/consume-proof','POST',consume,driverActor.access),picked);
 await call(assignmentPath+'/arrive','POST',{...fence,stage:'DROPOFF',idempotencyKey:randomUUID()},driverActor.access);
 await call(mobile+'/food/assignments/'+assignment.assignmentId+'/delivery-proof','POST',{...fence,idempotencyKey:randomUUID(),rotate:false},driverActor.access,404);
 const deliveredProof=await call(mobile+'/food/assignments/'+assignment.assignmentId+'/delivery-proof','POST',{...fence,idempotencyKey:randomUUID(),rotate:false},customerToken),deliveryCommand={...fence,proofId:deliveredProof.proofId,idempotencyKey:randomUUID(),secret:deliveredProof.secret},delivered=await call(assignmentPath+'/consume-proof','POST',deliveryCommand,driverActor.access);assert.equal(delivered.accepted,true);assert.deepEqual(await call(assignmentPath+'/consume-proof','POST',deliveryCommand,driverActor.access),delivered);
 assert.deepEqual(await call(mobile+'/food/shipments/'+ship+'/tracking','GET',undefined,customerToken),{assignment:null});assert.deepEqual(await call(mobile+'/driver/food/work','GET',undefined,driverActor.access),{offers:[],assignment:null});
 const persisted=(await db.query("SELECT s.state,f.status AS kitchen,a.state AS assignment,l.state AS lease,e.state AS earning,facts.amount_minor::text AS minor,(SELECT sum(debit_minor)::text FROM bitpos.ledger_entries WHERE transaction_id=e.ledger_transaction_id) AS debit,(SELECT sum(credit_minor)::text FROM bitpos.ledger_entries WHERE transaction_id=e.ledger_transaction_id) AS credit FROM bitpos.food_shipments s JOIN bitpos.order_fulfillment f ON (f.merchant_id,f.order_id)=(s.merchant_id,s.order_id) JOIN bitpos.food_assignments a ON a.shipment_id=s.id JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id JOIN bitpos.earning_accruals e ON e.food_assignment_id=a.id JOIN bitpos.earning_accrual_facts facts ON facts.accrual_id=e.id WHERE s.id=$1",[ship])).rows;assert.deepEqual(persisted,[{state:'DELIVERED',kitchen:'COLLECTED',assignment:'DELIVERED',lease:'RELEASED',earning:'ACCRUED',minor:'100',debit:'100',credit:'100'}]);
 passed.push('Merchant pickup secret returned once; wrong-secret replay preserves attempts; separate customer delivery proof closes lease with exactly100 minor balanced durable earning, not payout');
 if(process.argv.includes('--chat103-read-http')){
  const {verifyChat103Closed}=await import('./food-chat103-read-http-smoke');
  await verifyChat103Closed({db,base,assignmentId:assignment.assignmentId,customer:{account:customer.accountId,access:customerToken},driverActor,outsider});
 }
 if(process.argv.includes('--chat102-http')){
  const {verifyDaily101Http}=await import('./food-chat102-http-smoke');
  await verifyDaily101Http({db,base,assignmentId:assignment.assignmentId,driverId:driver,customer:{account:customer.accountId,access:customerToken},driverActor,outsider});
 }
 if(process.argv.includes('--settlement088-sql')){
  const {verifySettlement088Lifecycle}=await import('./settlement088-lifecycle-smoke');
  await verifySettlement088Lifecycle({db,assignmentId:assignment.assignmentId,driverAccount:driverActor.account,driverAccess:driverActor.access,financeAccount:dispatcher.account,financeAccess:dispatcher.access,merchant});
 }
 if(process.argv.includes('--settlement088-http')){
  const {verifySettlement088Http}=await import('./settlement088-http-smoke');
  await verifySettlement088Http({db,base,assignmentId:assignment.assignmentId,merchant,foreignMerchant,driver,driverActor,dispatcher,outsider,call});
 }
 if(process.argv.includes('--customer-progress-terminal-sql')){
  const {verifyFoodCustomerDispatchProgressSql}=await import('./food-customer-dispatch-progress-sql-smoke');
  const session=(await db.query('SELECT id FROM bitpos.mobile_sessions WHERE account_id=$1 AND access_hash=$2',[customer.accountId,hash(customerToken)])).rows[0].id;
  await verifyFoodCustomerDispatchProgressSql({db,shipment:ship,orderId,product,branch,driver,assignment,dispatcher,driverActor,customer:{account:customer.accountId,session,access:customerToken},outsider,terminal:true});
 }
 const receipt={status:currentE2e?'PASS_LOCAL_DISPOSABLE_FOOD_DELIVERY_HTTP_SQL_E2E':'PASS',base,merchant,branch,orderId,shipmentId:ship,assignmentId:assignment.assignmentId,persisted,passed,fixtures:['Synthetic OTP/provider and seeded driver/staff sessions/documents','Synthetic SQL-only verified settlement seam, not chain proof','Injected integer coordinates, not real GPS'],limits:['HTTP and committed SQL only; no Flutter/AVD dispatch or external payment/payout acceptance','No physical delivery, external provider payment, payout transfer, or production acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};const runDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');const receiptName=currentE2e?`delivery-food-current-http-sql-${runDate}.json`:process.argv.includes('--settlement088-sql')?'settlement088-canonical-delivery-httpfixture-20261019.json':process.argv.includes('--customer-progress-terminal-sql')?'dispatch086-customer-progress-terminal-httpfixture-20261019.json':(process.argv.includes('--ranking-regression')?'dispatch075-manual-regression':'dispatch066-http-lifecycle')+'-20261018.json';await writeFile('.omp/work/flutter-delivery-20261016/evidence/'+receiptName,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 }
 }
 }
}
}catch(error){await db.query('ROLLBACK');await writeFile(`.omp/work/flutter-delivery-20261016/evidence/${searchStage?'dispatch074-search-http':'dispatch066-http'}-failure-${Date.now()}.json`,JSON.stringify({status:'FAIL',merchant,branch,orderId,passed,error:error instanceof Error?error.message:'Unknown failure',physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');throw error;}
finally{
 if(!keepJoinedFixture&&customerToken)await call(mobile+'/auth/logout','POST',{allDevices:false},customerToken);
 if(!keepJoinedFixture&&merchantToken)await call('/api/session','DELETE',undefined,merchantToken);
 if(otherMerchantToken)await call('/api/session','DELETE',undefined,otherMerchantToken);
 if(!keepJoinedFixture){
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',[seedSessions]);if(!avdStage&&!process.argv.includes('--incident-browser-stage')){await db.query('UPDATE bitpos.platform_staff_role_grants SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1',[grant]);await db.query('UPDATE bitpos.driver_availability SET requested_online=false WHERE driver_id=$1',[driver]);}if(process.argv.includes('--current-e2e')||process.argv.includes('--pickup-current')||refundWalletFixture){
 await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=clock_timestamp() WHERE id IN(SELECT account_id FROM bitpos.mobile_sessions WHERE id=ANY($1::uuid[]))',[seedSessions]);
 await db.query('UPDATE bitpos.marketplace_branches SET enabled=false WHERE merchant_id=$1',[merchant]);
 await db.query('DELETE FROM bitpos.members WHERE user_id=$1 AND merchant_id=ANY($2::uuid[])',[staffUser,[merchant,foreignMerchant]]);
 }}await db.end();await pool.end();
}
