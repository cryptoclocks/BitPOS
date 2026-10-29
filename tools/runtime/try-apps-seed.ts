// LOCAL-ONLY seed for the hand-try stack (bitpos_try_fixture on 55440 + tools/runtime/try-apps-server.ts on 3043).
//   tsx tools/runtime/try-apps-seed.ts setup   one-time: accounts, merchant, menu, options, coupon, rewards, slots, hours, rider
//   tsx tools/runtime/try-apps-seed.ts offer [--delay=S]   new paid delivery order + a fresh dispatch offer for the rider (repeatable)
//   tsx tools/runtime/try-apps-seed.ts points  give the customer some reward points
// Synthetic only: SQL-only payment seam (not chain proof), synthetic identities, no real KYC. Refuses any other database.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
process.env.DOTENV_CONFIG_PATH='/dev/null';
const DB='bitpos_try_fixture',BASE=process.env.BITPOS_TRY_BASE??'http://127.0.0.1:3043',M='/api/mobile/v1';
Object.assign(process.env,{DATABASE_URL:`postgresql://bitpos_app@127.0.0.1:55440/${DB}`,ADMIN_DATABASE_URL:`postgresql://cryptoclock@127.0.0.1:55440/${DB}`,AUTH_URL:'http://127.0.0.1:3044',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'try-apps-fixture-only-not-a-real-secret-00000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-try-no-wallets'});
const {hash,MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {publishProductOptions}=await import('../../apps/api/src/online-options');
const {openingHoursSettings}=await import('../../apps/api/src/opening-hours');
const {rewardSettings}=await import('../../apps/api/src/reward-vouchers');
const {fixturePaymentAttempt}=await import('../../tests/backend-payment-fixture');
const {settleAttempt}=await import('../../apps/api/src/orders');
const {pool,tenant}=await import('../../apps/api/src/db');
const stateDir=join(homedir(),'.local/share/bitpos-try-fixture'),statePath=join(stateDir,'state.json');
const CUSTOMER_PHONE='+66900000001',RIDER_PHONE='+66900000002',CODE='123456',STAFF='fa000000-0000-4000-8000-000000000010';
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
assert.equal((await db.query('SELECT current_database() n')).rows[0].n,DB);
async function call(path:string,method='GET',body?:unknown,token?:string,status=200){
 const r=await fetch(BASE+path,{method,headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text(),value=text?JSON.parse(text):null;assert.equal(r.status,status,`${method} ${path} -> ${r.status} ${text.slice(0,300)}`);return value;
}
const login=(phone:string)=>call(M+'/auth/verify','POST',{phone,code:CODE,deviceId:randomUUID()});
async function seedStaff(){
 const account=randomUUID(),session=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url');
 await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,account,randomUUID(),hash(access),hash(refresh)]);
 await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',[hash(refresh),session]);
 return {account,access};
}
type State={merchant:string;branch:string;product:string;policy:string;driver:string;customerAccount:string;riderAccount:string};
async function setup(){
 await mkdir(stateDir,{recursive:true,mode:0o700});
 assert.equal((await db.query('SELECT count(*)::int n FROM bitpos.merchants')).rows[0].n,0,'setup already ran (merchants exist)');
 const customer=await login(CUSTOMER_PHONE),rider=await login(RIDER_PHONE);
 await db.query("UPDATE bitpos.mobile_accounts SET display_name=$2,locale='th' WHERE id=$1",[customer.accountId,'ลูกค้าทดลอง']);
 await db.query("UPDATE bitpos.mobile_accounts SET display_name=$2,locale='th' WHERE id=$1",[rider.accountId,'ไรเดอร์ทดลอง']);
 const merchant=randomUUID(),branch=randomUUID(),policy=randomUUID(),driver=randomUUID();
 const products=[
  {id:randomUUID(),name:'ลาเต้เย็น',en:'Iced latte',cat:'กาแฟ',price:270,stock:200,desc:'เอสเปรสโซ่ นมสด น้ำแข็ง'},
  {id:randomUUID(),name:'อเมริกาโน่',en:'Americano',cat:'กาแฟ',price:220,stock:200,desc:'กาแฟดำเข้ม'},
  {id:randomUUID(),name:'ชาไทยเย็น',en:'Thai iced tea',cat:'ชา',price:180,stock:150,desc:'ชาไทยแท้ หวานมัน'},
  {id:randomUUID(),name:'ครัวซองต์เนยสด',en:'Butter croissant',cat:'เบเกอรี่',price:150,stock:40,desc:'อบสดทุกเช้า'},
  {id:randomUUID(),name:'เค้กช็อกโกแลต',en:'Chocolate cake',cat:'เบเกอรี่',price:290,stock:12,desc:'ช็อกโกแลตเข้มข้น'},
  {id:randomUUID(),name:'ข้าวผัดกะเพราไก่ไข่ดาว',en:'Basil chicken rice with fried egg',cat:'อาหารจานเดียว',price:350,stock:60,desc:'เผ็ดกลาง'}];
 await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[merchant]);
 await db.query("INSERT INTO merchants(id,name,treasury) VALUES($1,'ร้านลองแอป BitPOS (Try Cafe, fixture)','11111111111111111111111111111111')",[merchant]);
 await db.query("INSERT INTO marketplace_branches(merchant_id,id,name,name_en,address_label,latitude,longitude,enabled,pickup_enabled,delivery_enabled) VALUES($1,$2,'Try Cafe สาขาทดลอง','Try Cafe fixture branch','ถนนทดลอง กรุงเทพฯ (ข้อมูลสมมติ)',13.7560,100.5018,true,true,true)",[merchant,branch]);
 for(const [i,p] of products.entries())await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock,category,description,sort_order) VALUES($1,$2,$3,$4,'',$5,$6,$7,$8,$9)",[p.id,merchant,p.name,p.en,p.price,p.stock,p.cat,p.desc,i+1]);
 await db.query("INSERT INTO members(user_id,merchant_id,role) VALUES($1,$2,'owner')",[STAFF,merchant]);
 const prices=await publishPrices(db as unknown as pg.PoolClient,merchant,STAFF,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'TRY-APPS LOCAL FIXTURE'},prices:products.map(p=>({productId:p.id,unitMinor:String(p.price)})),settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 const option=(name:string,nameEn:string,min:number,max:number,choices:[string,string,number][])=>({id:randomUUID(),name,nameEn,enabled:true,minSelections:min,maxSelections:max,choices:choices.map(([n,e,d])=>({id:randomUUID(),name:n,nameEn:e,enabled:true,maxQty:3,priceDelta:{currency:'USD',decimals:2,amountMinor:String(d)}}))});
 await publishProductOptions(db as unknown as pg.PoolClient,merchant,STAFF,'owner',products[0].id,{expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion:prices.priceVersion,noteEnabled:true,groups:[option('ขนาดนม','Milk',1,1,[['นมสด','Whole milk',0],['นมโอ๊ต','Oat milk',40]]),option('ท็อปปิ้ง','Topping',0,2,[['ช็อตเพิ่ม','Extra shot',35],['วิปครีม','Whipped cream',25]])]});
 await publishProductOptions(db as unknown as pg.PoolClient,merchant,STAFF,'owner',products[5].id,{expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion:prices.priceVersion,noteEnabled:true,groups:[option('เพิ่มเติม','Extras',0,2,[['ไข่ดาวเพิ่ม','Extra fried egg',30],['ข้าวเพิ่ม','Extra rice',20]])]});
 const priceVersion=(await db.query('SELECT active_price_version_id FROM merchant_pricing WHERE merchant_id=$1',[merchant])).rows[0].active_price_version_id;
 await db.query("INSERT INTO delivery_policy_versions(merchant_id,branch_id,id,price_version_id,currency,decimals,name,origin_latitude_e7,origin_longitude_e7,south_e7,north_e7,west_e7,east_e7,delivery_minor,service_minor,merchant_minor,driver_minor,platform_minor,published_by,fixture) VALUES($1,$2,$3,$4,'USD',2,'TRY-APPS FIXTURE',137560000,1005018000,137000000,138000000,1004000000,1006000000,100,20,0,100,20,$5,true)",[merchant,branch,policy,priceVersion,customer.accountId]);
 await db.query('INSERT INTO branch_delivery_policies VALUES($1,$2,1,$3,true)',[merchant,branch,policy]);
 // Merchant-funded coupon TRY50 (fixed 0.50 off, min food 1.00) valid for pickup and delivery for 30 days.
 const campaign=randomUUID(),version=randomUUID();
 await db.query("INSERT INTO coupon097_campaigns(id,merchant_id,code,name)VALUES($1,$2,'TRY50','ส่วนลด 0.50 (fixture)')",[campaign,merchant]);
 await db.query("INSERT INTO coupon097_versions(id,merchant_id,campaign_id,revision,price_version_id,discount_kind,fixed_minor,minimum_food_minor,maximum_discount_minor,global_cap,account_cap,budget_minor,merchant_funding_bps,serving,starts_at,expires_at)VALUES($1,$2,$3,1,$4,'FIXED',50,100,1000,1000,1000,1000000,10000,ARRAY['pickup','delivery'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 days')",[version,merchant,campaign,priceVersion]);
 await db.query('UPDATE coupon097_campaigns SET active_version_id=$2,enabled=true WHERE id=$1',[campaign,version]);
 // Schedule windows (pickup and delivery) on the next three days, several slots a day.
 for(const day of [0,1,2])for(const hour of [10,12,14,16])for(const serving of ['pickup','delivery'])
  await db.query("INSERT INTO schedule107_windows(id,merchant_id,branch_id,serving,timezone,starts_at,ends_at,kitchen_release_at,booking_closes_at,capacity)VALUES($1,$2,$3,$4,'Asia/Bangkok',date_trunc('day',clock_timestamp())+$5::int*interval '1 day'+$6::int*interval '1 hour'+interval '1 day',date_trunc('day',clock_timestamp())+$5::int*interval '1 day'+$6::int*interval '1 hour'+interval '1 day 30 minutes',date_trunc('day',clock_timestamp())+$5::int*interval '1 day'+$6::int*interval '1 hour'+interval '1 day'-interval '30 minutes',date_trunc('day',clock_timestamp())+$5::int*interval '1 day'+$6::int*interval '1 hour'+interval '1 day'-interval '60 minutes',20)",[randomUUID(),merchant,branch,serving,day,hour]);
 // Dispatch and rider.
 await db.query("INSERT INTO driver_profiles(id,account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,$2,'ไรเดอร์ทดลอง (fixture)',clock_timestamp()+interval '60 days','APPROVED',clock_timestamp()+interval '30 days',$3,'Synthetic document fixture, not real KYC')",[driver,rider.accountId,customer.accountId]);
 await db.query("INSERT INTO driver_vehicles VALUES($1,'MOTORCYCLE','FIXTURE','Fixture','Purple',clock_timestamp()+interval '30 days')",[driver]);
 await db.query('INSERT INTO driver_occupancy(driver_id) VALUES($1)',[driver]);
 await db.query('COMMIT');
 await tenant(merchant,db2=>openingHoursSettings(db2,merchant,STAFF,'owner','PUT',{expectedRevision:0,timeZone:'Asia/Bangkok',week:Object.fromEntries(['0','1','2','3','4','5','6'].map(d=>[d,[{opens:'00:00',closes:'23:59'}]]))}));
 await tenant(merchant,async db2=>{
  await rewardSettings(db2,merchant,STAFF,'owner','PUT',{slot:1,nameTh:'ส่วนลด 0.50',nameEn:'0.50 off',pointsCost:5,discountMinor:'50',minimumSpendMinor:'200',validityDays:30,enabled:true});
  await rewardSettings(db2,merchant,STAFF,'owner','PUT',{slot:2,nameTh:'ส่วนลด 1.00',nameEn:'1.00 off',pointsCost:10,discountMinor:'100',minimumSpendMinor:'400',validityDays:30,enabled:true});
 });
 // Customer address (version 1) so delivery checkout works at once.
 await call(M+'/account/addresses','POST',{idempotencyKey:randomUUID(),address:{label:'บ้าน (fixture)',recipientName:'ลูกค้าทดลอง',phone:CUSTOMER_PHONE,addressText:'99 ถนนทดลอง กรุงเทพฯ (ข้อมูลสมมติ)',instructions:'LOCAL FIXTURE ONLY',latitudeE7:137560001,longitudeE7:1005018001}},customer.accessToken);
 const state:State={merchant,branch,product:products[0].id,policy,driver,customerAccount:customer.accountId,riderAccount:rider.accountId};
 await writeFile(statePath,JSON.stringify(state,null,2),{mode:0o600});
 console.log('setup done',JSON.stringify(state));
}
async function offer(){
 const s:State=JSON.parse(await readFile(statePath,'utf8')),customer=await login(CUSTOMER_PHONE);
 const dispatcher=await seedStaff(),grant=randomUUID();
 await db.query("UPDATE bitpos.platform_staff_role_grants SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE revoked_at IS NULL AND granted_by='Try-apps fixture'");
 await db.query("INSERT INTO bitpos.platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,'dispatcher','Try-apps fixture',clock_timestamp()+interval '1 hour')",[grant,dispatcher.account]);
 await db.query('INSERT INTO bitpos.platform_role_scopes VALUES($1,$2)',[grant,s.merchant]);
 await db.query("INSERT INTO bitpos.driver_availability(driver_id,requested_online,heartbeat_expires_at) VALUES($1,true,clock_timestamp()+interval '10 minutes') ON CONFLICT(driver_id) DO UPDATE SET requested_online=true,heartbeat_expires_at=excluded.heartbeat_expires_at",[s.driver]);
 const merchantToken=(await call('/api/session','POST',{email:'merchant@bitpos.invalid',password:'local-fixture-only',merchantId:s.merchant})).token;
 try{
  const plain=(await db.query("SELECT id FROM bitpos.products WHERE merchant_id=$1 AND name='ครัวซองต์เนยสด'",[s.merchant])).rows[0].id;
  const addresses=await call(M+'/account/addresses',undefined,undefined,customer.accessToken),address=addresses.addresses.find((a:{archived:boolean})=>!a.archived);assert.ok(address,'customer address');
  const quote=await call(M+'/food/quotes','POST',{branchId:s.branch,serving:'delivery',items:[{lineId:randomUUID(),productId:plain,qty:1,optionVersion:null,selections:[],allergyNote:null}],delivery:{addressId:address.id,addressVersion:address.version,policyVersionId:s.policy}},customer.accessToken);
  const orderId=(await call(M+'/food/orders','POST',{branchId:s.branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()},customer.accessToken)).order.id;
  await call('/api/orders/'+orderId+'/acceptance','POST',{status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23},merchantToken);
  await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[s.merchant]);
  const attempt=(await fixturePaymentAttempt(db,{merchant:s.merchant,order:orderId,status:'SUBMITTED',signature:'TRY-APPS-SQL-FIXTURE-'+randomUUID()})).rows[0];
  await settleAttempt(db as unknown as pg.PoolClient,attempt,true);await db.query('COMMIT');
  await call('/api/orders/'+orderId+'/fulfillment','POST',{status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()},merchantToken);
  await call('/api/orders/'+orderId+'/fulfillment','POST',{status:'READY',expectedVersion:1,idempotencyKey:randomUUID()},merchantToken);
  const work=await call('/api/orders/'+orderId+'/delivery','GET',undefined,merchantToken);
  const rev=(await db.query('SELECT revision::text v FROM bitpos.driver_food_service_grants WHERE driver_id=$1 AND branch_id=$2',[s.driver,s.branch])).rows[0]?.v??'0';
  await call(M+`/platform/merchants/${s.merchant}/branches/${s.branch}/drivers/${s.driver}/food-service`,'PUT',{idempotencyKey:randomUUID(),expectedVersion:rev,enabled:true,validUntil:new Date(Date.now()+3600000).toISOString(),reason:'Try-apps fixture food service authority'},dispatcher.access);
  const delay=Number(process.argv.find(a=>a.startsWith('--delay='))?.slice(8)??0);if(delay>0)await new Promise(r=>setTimeout(r,delay*1000));
  const o=await call(M+'/platform/food/shipments/'+work.shipmentId+'/offers','POST',{idempotencyKey:randomUUID(),expectedVersion:work.version,driverId:s.driver},dispatcher.access);
  console.log(JSON.stringify({status:'OFFER_READY',orderId,shipmentId:work.shipmentId,offerId:o.offerId}));
 }catch(e){await db.query('ROLLBACK').catch(()=>undefined);throw e;}
 finally{await call('/api/session','DELETE',undefined,merchantToken).catch(()=>undefined);}
}
async function points(){
 const s:State=JSON.parse(await readFile(statePath,'utf8'));
 const cols=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='bitpos' AND table_name ILIKE '%reward%'")).rows.map(r=>r.table_name);
 console.log('reward tables',cols.join(','),'account',s.customerAccount);
}
try{
 const mode=process.argv[2];
 if(mode==='setup')await setup();else if(mode==='offer')await offer();else if(mode==='points')await points();else throw Error('usage: setup|offer|points');
}catch(e){await db.query('ROLLBACK').catch(()=>undefined);throw e;}
finally{await db.end();await pool.end();}
