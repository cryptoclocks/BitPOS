// OCI DEMO dispatcher helper (runs inside the api container, see oci-demo-seed.ts). The demo has no dispatcher staff UI
// in the apps, so this stands in for it: it sends a food-dispatch offer to the DEMO rider for the oldest PAID delivery
// order of the demo merchant that is READY and has no assignment/open offer. Order payment is NOT touched here: the
// customer paid it on devnet through the real checkout, and the merchant accepted/prepared it in the POS.
//   docker exec bitpos-runtime-api-1 node --import tsx tools/runtime/oci-demo-dispatch.ts [orderId]
// A 1-hour dispatcher grant scoped to the demo merchant is created for a throwaway staff account and revoked at the end.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import pg from 'pg';
const MERCHANT='11111111-1111-4111-8111-111111111111',RIDER_PHONE='+66900000002',CODE='123456';
const BASE=process.env.BITPOS_DEMO_API??'http://127.0.0.1:3001',M='/api/mobile/v1';
const {hash}=await import('../../packages/domain/src/index');
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();await db.query('SET search_path=bitpos,public');
async function call(path:string,method='GET',body?:unknown,token?:string){
 const r=await fetch(BASE+path,{method,headers:{'x-bitpos-client-ip':'127.0.0.1',...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await r.text(),value=text?JSON.parse(text):null;assert.ok(r.status<300,`${method} ${path} -> ${r.status} ${text.slice(0,300)}`);return value;
}
const rider=await call(M+'/auth/verify','POST',{phone:RIDER_PHONE,code:CODE,deviceId:randomUUID()});
const driver=(await db.query('SELECT id FROM driver_profiles WHERE account_id=$1',[rider.accountId])).rows[0]?.id;assert.ok(driver,'demo rider profile missing; run oci-demo-seed.ts');
const branch=(await db.query('SELECT id FROM marketplace_branches WHERE merchant_id=$1 ORDER BY id LIMIT 1',[MERCHANT])).rows[0].id;
const account=randomUUID(),session=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url'),grant=randomUUID();
await db.query('INSERT INTO mobile_accounts(id,auth_subject) VALUES($1,$2)',[account,randomUUID()]);
await db.query("INSERT INTO mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 day')",[session,account,randomUUID(),hash(access),hash(refresh)]);
await db.query('INSERT INTO mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',[hash(refresh),session]);
try{
 await db.query("INSERT INTO platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,'dispatcher','OCI demo dispatch helper',clock_timestamp()+interval '1 hour')",[grant,account]);
 await db.query('INSERT INTO platform_role_scopes VALUES($1,$2)',[grant,MERCHANT]);
 await db.query("INSERT INTO driver_availability(driver_id,requested_online,heartbeat_expires_at) VALUES($1,true,clock_timestamp()+interval '10 minutes') ON CONFLICT(driver_id) DO UPDATE SET requested_online=true,heartbeat_expires_at=excluded.heartbeat_expires_at",[driver]);
 const rev=(await db.query('SELECT revision::text v FROM driver_food_service_grants WHERE driver_id=$1 AND branch_id=$2',[driver,branch])).rows[0]?.v??'0';
 await call(M+`/platform/merchants/${MERCHANT}/branches/${branch}/drivers/${driver}/food-service`,'PUT',{idempotencyKey:randomUUID(),expectedVersion:rev,enabled:true,validUntil:new Date(Date.now()+3600000).toISOString(),reason:'OCI demo food service authority'},access);
 const wanted=process.argv[2];
 const row=(await db.query(`SELECT sh.id,sh.order_id,sh.version::text v FROM food_shipments sh WHERE sh.merchant_id=$1 AND ($2::uuid IS NULL OR sh.order_id=$2) AND NOT EXISTS(SELECT 1 FROM food_assignments a WHERE a.shipment_id=sh.id AND a.closed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM food_dispatch_offers f WHERE f.shipment_id=sh.id AND f.state='OFFERED') AND NOT EXISTS(SELECT 1 FROM food_assignments a WHERE a.shipment_id=sh.id AND a.state='DELIVERED') ORDER BY sh.created_at DESC LIMIT 1`,[MERCHANT,wanted??null])).rows[0];
 assert.ok(row,'no dispatchable delivery shipment (customer must pay and the merchant must mark it READY first)');
 const o=await call(M+'/platform/food/shipments/'+row.id+'/offers','POST',{idempotencyKey:randomUUID(),expectedVersion:row.v,driverId:driver},access);
 console.log(JSON.stringify({status:'OFFER_READY',orderId:row.order_id,shipmentId:row.id,offerId:o.offerId}));
}finally{
 await db.query("UPDATE platform_staff_role_grants SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1",[grant]).catch(()=>undefined);
 await db.end();
}
