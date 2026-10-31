// Local-only: the real group-order screen on the AVD against the own disposable fixture
// (API 3043 on DB 55440). Owner creates + invites + adds, member joins by code + adds, owner locks.
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import pg from 'pg';

const databaseUrl=process.env.BITPOS_DELIVERY_FIXTURE_DATABASE_URL;
if(!databaseUrl)throw new Error('BITPOS_DELIVERY_FIXTURE_DATABASE_URL is required');
const parsed=new URL(databaseUrl);
if(parsed.protocol!=='postgresql:'||parsed.hostname!=='127.0.0.1'||parsed.port!=='55440'||parsed.pathname!=='/bitpos_delivery_fixture'||parsed.search||parsed.hash)throw new Error('Group AVD smoke only accepts the own disposable loopback fixture');
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:databaseUrl.replace('cryptoclock@','bitpos_app@'),ADMIN_DATABASE_URL:databaseUrl,AUTH_URL:'http://127.0.0.1:55441',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {tenant}=await import('../../apps/api/src/db');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const api='http://10.0.2.2:3043/api/mobile/v1/';
const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const admin=new pg.Client({connectionString:databaseUrl});await admin.connect();
async function actor(name:string){
 const account=randomUUID(),session=randomUUID(),device=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url');
 await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,$3,'en')",[account,randomUUID(),name]);
 await admin.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '20 minutes',clock_timestamp()+interval '20 minutes')",[session,account,device,digest(access),digest(refresh)]);
 const blob=Buffer.from(JSON.stringify({accountId:account,sessionId:session,accessToken:access,refreshToken:refresh,accessExpiresAt:new Date(Date.now()+1200000).toISOString(),refreshExpiresAt:new Date(Date.now()+1200000).toISOString()})).toString('base64');
 return {account,device,blob};
}
const owner=await actor('Group AVD owner'),member=await actor('Group AVD member');
const merchant=randomUUID(),branch=randomUUID(),product=randomUUID(),admin_actor=randomUUID(),branchName='Group AVD branch';
await admin.query('INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,$2,$3)',[merchant,'Group AVD cafe','11111111111111111111111111111111']);
await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled,delivery_enabled) VALUES($1,$2,$3,$3,true,true,true)",[merchant,branch,branchName]);
await tenant(merchant,async db=>{
 await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'Group AVD latte','Group AVD latte','',270,6)",[product,merchant]);
 await publishPrices(db,merchant,admin_actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL GROUP AVD FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
});
const address=randomUUID(),policy=randomUUID();
const priceVersion=(await admin.query('SELECT active_price_version_id FROM bitpos.merchant_pricing WHERE merchant_id=$1',[merchant])).rows[0].active_price_version_id;
await admin.query("INSERT INTO bitpos.mobile_addresses(id,account_id,label,recipient_name,phone,address_text,instructions,latitude_e7,longitude_e7) VALUES($1,$2,'Group delivery','Fixture member','+66900000001','Synthetic group destination','',137560001,1005018001)",[address,member.account]);
await admin.query("INSERT INTO bitpos.delivery_policy_versions(merchant_id,branch_id,id,price_version_id,currency,decimals,name,origin_latitude_e7,origin_longitude_e7,south_e7,north_e7,west_e7,east_e7,delivery_minor,service_minor,merchant_minor,driver_minor,platform_minor,published_by,fixture) VALUES($1,$2,$3,$4,'USD',2,'GROUP AVD DELIVERY',137560000,1005018000,137000000,138000000,1004000000,1006000000,100,20,0,100,20,$5,true)",[merchant,branch,policy,priceVersion,member.account]);
await admin.query('INSERT INTO bitpos.branch_delivery_policies(merchant_id,branch_id,revision,active_version_id,enabled) VALUES($1,$2,1,$3,true)',[merchant,branch,policy]);
const flutter='/Users/cryptoclock/development/flutter/bin/flutter';
function run(stage:string,who:{blob:string;device:string},extra:Record<string,string>={}):Promise<string>{
 return new Promise((resolve,reject)=>{
  const args=['test','integration_test/group_order_root_test.dart','-d','emulator-5554','--dart-define=BITPOS_FIXTURE=true',`--dart-define=BITPOS_MOBILE_API=${api}`,`--dart-define=BITPOS_TEST_SESSION_BASE64=${who.blob}`,`--dart-define=BITPOS_TEST_DEVICE_ID=${who.device}`,`--dart-define=BITPOS_TEST_GROUP_STAGE=${stage}`,`--dart-define=BITPOS_TEST_GROUP_BRANCH=${branchName}`,...Object.entries(extra).map(([k,v])=>`--dart-define=${k}=${v}`)];
  const child=spawn(flutter,args,{cwd:'apps/mobile-customer',stdio:['ignore','pipe','pipe']});let out='';
  child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{out+=b;});
  child.once('error',reject);child.once('exit',code=>{if(code!==0&&process.env.BITPOS_GROUP_AVD_LOG)writeFileSync(process.env.BITPOS_GROUP_AVD_LOG,out);code===0?resolve(out):reject(new Error(`group ${stage} failed\n${out.slice(-1500)}`));});
 });
}
try{
 const created=await run('OWNER_CREATE',owner);
 const token=created.match(/BITPOS_GROUP_TOKEN:([A-Za-z0-9_-]{20,64})/)?.[1],groupId=created.match(/BITPOS_GROUP_ID:([0-9a-f-]{36})/)?.[1];
 assert.ok(token&&groupId,'owner screen must show the invite code and own a group');
 console.log('PASS owner created a group, invited and added an item');
 await run('MEMBER',member,{BITPOS_TEST_GROUP_TOKEN:token});
 console.log('PASS member joined by code and added items; lock control hidden for the member');
 await run('OWNER_LOCK',owner,{BITPOS_TEST_GROUP_ID:groupId});
 const state=(await admin.query('SELECT state,(SELECT count(*)::int FROM bitpos.group_cart_members WHERE group_id=g.id) members FROM bitpos.group_carts g WHERE id=$1',[groupId])).rows[0];
 const lines=(await admin.query('SELECT account_id,qty FROM bitpos.group_cart_lines WHERE group_id=$1 ORDER BY qty',[groupId])).rows.map(r=>[r.account_id===owner.account?'owner':'member',r.qty]);
 assert.deepEqual([state.state,state.members],['LOCKED',2]);
 assert.deepEqual(lines,[['owner',1],['member',2]]);
 await run('MEMBER_ORDER',member,{BITPOS_TEST_GROUP_ID:groupId});
 const orders=(await admin.query("SELECT f.acceptance_status,a.total_minor::text t,a.serving_kind,d.account_id,d.address_id,(SELECT count(*)::int FROM bitpos.payment_attempts p WHERE p.order_id=f.order_id) attempts FROM bitpos.online_food_orders f JOIN bitpos.order_authority a ON(a.merchant_id,a.order_id)=(f.merchant_id,f.order_id) JOIN bitpos.quote_delivery_snapshots d ON(d.merchant_id,d.quote_id)=(a.merchant_id,a.quote_id) WHERE f.merchant_id=$1",[merchant])).rows;
 assert.equal(orders.length,1,'only the member ordered; the group itself created no order');
 assert.equal(orders[0].attempts,0,'no payment attempt exists');
 assert.equal(orders[0].t,'660','delivery fees must be included in the canonical quote');
 assert.equal(orders[0].serving_kind,'delivery');
 assert.equal(orders[0].account_id,member.account,'delivery snapshot belongs to the ordering member');
 assert.equal(orders[0].address_id,address,'delivery snapshot uses the member address');
 console.log('PASS member priced and placed only their own delivery order: '+JSON.stringify(orders[0]));
 console.log('PASS_GROUP_JOINED_AVD LOCKED members=2 lines='+JSON.stringify(lines));
}finally{
 await admin.query('UPDATE bitpos.marketplace_branches SET enabled=false WHERE merchant_id=$1',[merchant]);
 await admin.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE account_id=ANY($1::uuid[])',[[owner.account,member.account]]);
 await admin.end();
}
