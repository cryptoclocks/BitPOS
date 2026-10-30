// OCI DEMO seed for the mobile apps. Runs INSIDE the api container (needs its DATABASE_URL/ADMIN_DATABASE_URL and the
// API on 127.0.0.1:3001):  docker cp this file into /app/tools/runtime/ then
//   docker exec bitpos-runtime-api-1 node --import tsx tools/runtime/oci-demo-seed.ts
// It publishes the existing demo merchant "BitPOS Purple Cafe" for mobile ordering (marketplace branch, delivery policy,
// opening hours, coupon DEMO5, schedule slots, loyalty rewards) and registers the two DEMO phone accounts (customer, rider)
// through the API's own sign-in. Data is labelled demo; no real KYC, no real delivery. Idempotent: does nothing if the branch exists.
// The demo sign-in numbers only work because GoTrue GOTRUE_SMS_TEST_OTP lists them; no other number can sign in.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const MERCHANT='11111111-1111-4111-8111-111111111111',OWNER='8fe2391e-b5a7-4b7a-8d6f-97e29c609617';
const CUSTOMER_PHONE='+66900000001',RIDER_PHONE='+66900000002',CODE='123456';
const BASE=process.env.BITPOS_DEMO_API??'http://127.0.0.1:3001',M='/api/mobile/v1';
const {tenant}=await import('../../apps/api/src/db');
const {publishProductOptions}=await import('../../apps/api/src/online-options');
const {openingHoursSettings}=await import('../../apps/api/src/opening-hours');
const {rewardSettings}=await import('../../apps/api/src/reward-vouchers');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
async function call(path:string,method='GET',body?:unknown,token?:string){
 const r=await fetch(BASE+path,{method,headers:{'x-bitpos-client-ip':'127.0.0.1',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text(),value=text?JSON.parse(text):null;assert.ok(r.status<300,`${method} ${path} -> ${r.status} ${text.slice(0,300)}`);return value;
}
const login=(phone:string)=>call(M+'/auth/verify','POST',{phone,code:CODE,deviceId:randomUUID()});
const merchant=(await db.query('SELECT name FROM bitpos.merchants WHERE id=$1',[MERCHANT])).rows[0];
assert.equal(merchant?.name,'BitPOS Purple Cafe','demo merchant not found');
await db.query('SET search_path=bitpos,public');
const existing=(await db.query('SELECT id FROM bitpos.marketplace_branches WHERE merchant_id=$1',[MERCHANT])).rows[0];
const customer=await login(CUSTOMER_PHONE),rider=await login(RIDER_PHONE);
await db.query("UPDATE bitpos.mobile_accounts SET display_name=$2,locale='th' WHERE id=$1",[customer.accountId,'ลูกค้าเดโม']);
await db.query("UPDATE bitpos.mobile_accounts SET display_name=$2,locale='th' WHERE id=$1",[rider.accountId,'ไรเดอร์เดโม']);
const pv=(await db.query('SELECT active_price_version_id v FROM bitpos.merchant_pricing WHERE merchant_id=$1',[MERCHANT])).rows[0].v;
const price=(await db.query('SELECT currency,decimals FROM bitpos.catalog_price_versions WHERE merchant_id=$1 AND id=$2',[MERCHANT,pv])).rows[0];
assert.deepEqual([price.currency,price.decimals],['USD',4],'unexpected catalog currency');
// Amounts are in the catalogue's 4-decimal USD minor units (demo items are 0.10 each on devnet).
const branch=randomUUID(),policy=randomUUID(),driver=randomUUID();
if(!existing){
await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[MERCHANT]);
await db.query("INSERT INTO marketplace_branches(merchant_id,id,name,name_en,address_label,latitude,longitude,enabled,pickup_enabled,delivery_enabled) VALUES($1,$2,'BitPOS Purple Cafe สาขาเดโม','BitPOS Purple Cafe demo branch','กรุงเทพฯ (สาขาเดโม ข้อมูลสมมติ)',13.7560,100.5018,true,true,true)",[MERCHANT,branch]);
await db.query("INSERT INTO delivery_policy_versions(merchant_id,branch_id,id,price_version_id,currency,decimals,name,origin_latitude_e7,origin_longitude_e7,south_e7,north_e7,west_e7,east_e7,delivery_minor,service_minor,merchant_minor,driver_minor,platform_minor,published_by,fixture) VALUES($1,$2,$3,$4,'USD',4,'DEMO delivery (devnet amounts)',137560000,1005018000,137000000,138000000,1004000000,1006000000,1000,200,0,1000,200,$5,true)",[MERCHANT,branch,policy,pv,customer.accountId]);
await db.query('INSERT INTO branch_delivery_policies VALUES($1,$2,1,$3,true)',[MERCHANT,branch,policy]);
const campaign=randomUUID(),version=randomUUID();
await db.query("INSERT INTO coupon097_campaigns(id,merchant_id,code,name)VALUES($1,$2,'DEMO5','ส่วนลดเดโม 0.05')",[campaign,MERCHANT]);
await db.query("INSERT INTO coupon097_versions(id,merchant_id,campaign_id,revision,price_version_id,discount_kind,fixed_minor,minimum_food_minor,maximum_discount_minor,global_cap,account_cap,budget_minor,merchant_funding_bps,serving,starts_at,expires_at)VALUES($1,$2,$3,1,$4,'FIXED',500,1000,1000,1000,1000,1000000,10000,ARRAY['pickup','delivery'],clock_timestamp()-interval '1 minute',clock_timestamp()+interval '30 days')",[version,MERCHANT,campaign,pv]);
await db.query('UPDATE coupon097_campaigns SET active_version_id=$2,enabled=true WHERE id=$1',[campaign,version]);
const day="(date_trunc('day',clock_timestamp() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok')+$5::int*interval '1 day'+$6::int*interval '1 hour'";
for(const d of [0,1,2])for(const hour of [10,12,14,16])for(const serving of ['pickup','delivery'])
 await db.query(`INSERT INTO schedule107_windows(id,merchant_id,branch_id,serving,timezone,starts_at,ends_at,kitchen_release_at,booking_closes_at,capacity)VALUES($1,$2,$3,$4,'Asia/Bangkok',${day}+interval '1 day',${day}+interval '1 day 30 minutes',${day}+interval '1 day'-interval '30 minutes',${day}+interval '1 day'-interval '60 minutes',20)`,[randomUUID(),MERCHANT,branch,serving,d,hour]);
await db.query("INSERT INTO driver_profiles(id,account_id,display_name,license_expires_at,status,verified_until,verified_by,verification_reference) VALUES($1,$2,'ไรเดอร์เดโม',clock_timestamp()+interval '60 days','APPROVED',clock_timestamp()+interval '30 days',$3,'DEMO seed: synthetic document check, not real KYC')",[driver,rider.accountId,customer.accountId]);
await db.query("INSERT INTO driver_vehicles VALUES($1,'MOTORCYCLE','DEMO','Demo','Purple',clock_timestamp()+interval '30 days')",[driver]);
await db.query('INSERT INTO driver_occupancy(driver_id) VALUES($1)',[driver]);
await db.query("INSERT INTO driver_availability(driver_id,requested_online,heartbeat_expires_at) VALUES($1,false,clock_timestamp())",[driver]);
await db.query('COMMIT');
}
// Later steps are re-runnable: a step that already happened reports and is skipped.
const step=async(name:string,fn:()=>Promise<unknown>)=>{try{await fn();console.log('step ok',name);}catch(e){console.log('step skipped',name,String((e as Error).message).slice(0,160));}};
await step('hours',()=>tenant(MERCHANT,db2=>openingHoursSettings(db2,MERCHANT,OWNER,'owner','PUT',{expectedRevision:0,timeZone:'Asia/Bangkok',week:Object.fromEntries(['0','1','2','3','4','5','6'].map(d=>[d,[{opens:'00:00',closes:'23:59'}]]))})));
await step('rewards',()=>tenant(MERCHANT,async db2=>{
 await rewardSettings(db2,MERCHANT,OWNER,'owner','PUT',{slot:1,nameTh:'ส่วนลด 0.05',nameEn:'0.05 off',pointsCost:5,discountMinor:'500',minimumSpendMinor:'1000',validityDays:30,enabled:true});
 await rewardSettings(db2,MERCHANT,OWNER,'owner','PUT',{slot:2,nameTh:'ส่วนลด 0.10',nameEn:'0.10 off',pointsCost:10,discountMinor:'1000',minimumSpendMinor:'2000',validityDays:30,enabled:true});
}));
// Options on the iced latte so size/topping selection is demonstrable.
const option=(name:string,nameEn:string,min:number,max:number,choices:[string,string,number][])=>({id:randomUUID(),name,nameEn,enabled:true,minSelections:min,maxSelections:max,choices:choices.map(([n,e,d])=>({id:randomUUID(),name:n,nameEn:e,enabled:true,maxQty:3,priceDelta:{currency:'USD',decimals:4,amountMinor:String(d)}}))});
await step('options',async()=>{await db.query('BEGIN');await db.query('SET LOCAL search_path=bitpos,public');await db.query("SELECT set_config('bitpos.merchant',$1,true)",[MERCHANT]);try{await publishProductOptions(db as unknown as pg.PoolClient,MERCHANT,OWNER,'owner','c8b0e582-156f-4c5a-8807-fc41e9368d9f',{expectedRevision:'0',idempotencyKey:randomUUID(),priceVersion:pv,noteEnabled:true,groups:[option('ขนาดนม','Milk',1,1,[['นมสด','Whole milk',0],['นมโอ๊ต','Oat milk',400]]),option('ท็อปปิ้ง','Topping',0,2,[['ช็อตเพิ่ม','Extra shot',300],['วิปครีม','Whipped cream',200]])]});await db.query('COMMIT');}catch(e){await db.query('ROLLBACK');throw e;}});
await step('address',()=>call(M+'/account/addresses','POST',{idempotencyKey:randomUUID(),address:{label:'บ้าน (เดโม)',recipientName:'ลูกค้าเดโม',phone:CUSTOMER_PHONE,addressText:'99 ถนนเดโม กรุงเทพฯ (ข้อมูลสมมติ)',instructions:'DEMO',latitudeE7:137560001,longitudeE7:1005018001}},customer.accessToken));
console.log(JSON.stringify({seeded:true,branch,policy,driver,customerAccount:customer.accountId,riderAccount:rider.accountId}));
await db.end();
