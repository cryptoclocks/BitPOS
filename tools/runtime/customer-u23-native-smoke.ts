import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';

const databaseUrl=process.env.BITPOS_DELIVERY_FIXTURE_DATABASE_URL;
if(!databaseUrl)throw new Error('BITPOS_DELIVERY_FIXTURE_DATABASE_URL is required');
const parsed=new URL(databaseUrl);
if(parsed.protocol!=='postgresql:'||parsed.hostname!=='127.0.0.1'||parsed.pathname!=='/bitpos_delivery_fixture'||parsed.search||parsed.hash)throw new Error('U23 smoke only accepts the named disposable loopback fixture');
const apiBase=process.env.BITPOS_FIXTURE_API_BASE??'http://127.0.0.1:3043/api/mobile/v1/';
if(apiBase!=='http://127.0.0.1:3043/api/mobile/v1/')throw new Error('Unexpected local fixture API origin');
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{DATABASE_URL:databaseUrl.replace('cryptoclock@','bitpos_app@'),ADMIN_DATABASE_URL:databaseUrl,AUTH_URL:'http://127.0.0.1:55441',AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets'});
const {tenant}=await import('../../apps/api/src/db');
const {publishPrices}=await import('../../apps/api/src/catalog');
const {MINT,TOKEN_PROGRAM}=await import('../../packages/domain/src/index');
const admin=new pg.Client({connectionString:databaseUrl,statement_timeout:10000});
const merchant=randomUUID(),branch=randomUUID(),product=randomUUID(),account=randomUUID(),session=randomUUID(),device=randomUUID(),access=randomBytes(32).toString('base64url'),refresh=randomBytes(32).toString('base64url'),actor=randomUUID();
const evidence='.omp/work/flutter-delivery-20261016/evidence',date='20261021',merchantName='BitPOS Cafe';
const orderIds:string[]=[];await admin.connect();
function owned(file:string):Promise<void>{return new Promise<void>((resolve,reject)=>{const child=scope.track(spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554','exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']}));const bytes:Buffer[]=[];child.stdout.on('data',chunk=>bytes.push(chunk));child.stderr.on('data',chunk=>process.stderr.write(chunk));scope.wait(once(child,'exit')).then(([code])=>{if(code!==0)return reject(Error('AVD screenshot failed'));return writeFile(`${evidence}/${file}`,Buffer.concat(bytes)).then(()=>resolve(),reject);},reject);});}
class Scope{children=new Set<ReturnType<typeof spawn>>();track<T extends ReturnType<typeof spawn>>(child:T):T{this.children.add(child);child.once('exit',()=>this.children.delete(child));return child;}async wait(event:Promise<any>){return await event;}close(){for(const child of this.children)child.kill('SIGTERM');this.children.clear();}}
const scope=new Scope();
try{
 await admin.query('INSERT INTO bitpos.merchants(id,name,treasury) VALUES($1,$2,$3)',[merchant,merchantName,'11111111111111111111111111111111']);
 await admin.query("INSERT INTO bitpos.marketplace_branches(merchant_id,id,name,name_en,enabled,pickup_enabled) VALUES($1,$2,'ร้านทดสอบกิจกรรม','Activity test branch',true,true)",[merchant,branch]);
 await admin.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,display_name,locale) VALUES($1,$2,'U23 AVD fixture','en')",[account,randomUUID()]);
 await admin.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '10 minutes',clock_timestamp()+interval '10 minutes')",[session,account,device,createHash('sha256').update(access).digest('hex'),createHash('sha256').update(refresh).digest('hex')]);
 await tenant(merchant,async db=>{
  await db.query("INSERT INTO products(id,merchant_id,name,name_en,emoji,price_minor,stock) VALUES($1,$2,'อาหารทดสอบ','Fixture food','',270,4)",[product,merchant]);
  await publishPrices(db,merchant,actor,'owner',{expectedRevision:'0',catalogCurrency:'USD',provenance:{kind:'demo_configured',label:'LOCAL U23 ACCEPTANCE FIXTURE'},prices:[{productId:product,unitMinor:'270'}],settlement:{asset:'USDG',network:'solana:devnet',mint:MINT,tokenProgram:TOKEN_PROGRAM,decimals:6,quotePolicy:'USD_CENTS_TO_USDG_1_TO_1'}});
 });
 const headers={Authorization:'Bearer '+access,'Content-Type':'application/json'};
 for(let i=0;i<3;i++){
  const lineId=randomUUID();const quoteResponse:Response=await fetch(apiBase+'food/quotes',{method:'POST',headers,body:JSON.stringify({branchId:branch,serving:'pickup',items:[{lineId,productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null}]})});
  const quote=await quoteResponse.json() as any;assert.equal(quoteResponse.status,200,JSON.stringify(quote));assert.equal(quote.total.amountMinor,'270');
  const orderResponse:Response=await fetch(apiBase+'food/orders',{method:'POST',headers,body:JSON.stringify({branchId:branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()})});
  const created=await orderResponse.json() as any;assert.equal(orderResponse.status,200,JSON.stringify(created));orderIds.push(created.order.id);
 }
 for(const [index,daysAgo] of [0,1,9].entries())await admin.query('UPDATE bitpos.orders SET created_at=clock_timestamp()-($2::int*interval \'1 day\') WHERE merchant_id=$3 AND id=$1',[orderIds[index],daysAgo,merchant]);
 const orderId=orderIds[0];
 const historyResponse=await fetch(apiBase+'food/orders',{headers:{Authorization:'Bearer '+access}});const history=await historyResponse.json() as any;assert.equal(historyResponse.status,200,JSON.stringify(history));
 assert.equal(history.orders.length,3);assert.deepEqual(history.orders.map((item:any)=>item.id),orderIds);assert.ok(history.orders.every((item:any)=>item.merchantName===merchantName&&item.total.amountMinor==='270'));
 const flutter=scope.track(spawn('/Users/cryptoclock/development/flutter/bin/flutter',['test','integration_test/customer_history_root_test.dart','-d','emulator-5554','--dart-define=BITPOS_FIXTURE=true','--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:3043/api/mobile/v1/','--dart-define=BITPOS_TEST_ORDER_ID='+orderId,'--dart-define=BITPOS_TEST_ORDER_IDS='+Buffer.from(JSON.stringify(orderIds)).toString('base64'),'--dart-define=BITPOS_TEST_MERCHANT_NAME='+merchantName,'--dart-define=BITPOS_TEST_SESSION_BASE64='+Buffer.from(JSON.stringify({accountId:account,sessionId:session,accessToken:access,refreshToken:refresh,accessExpiresAt:new Date(Date.now()+600000).toISOString(),refreshExpiresAt:new Date(Date.now()+600000).toISOString()})).toString('base64'),'--dart-define=BITPOS_TEST_DEVICE_ID='+device,'--no-enable-impeller','--no-uninstall'],{cwd:'apps/mobile-customer',stdio:['ignore','pipe','pipe']}));
 let captured=false,geometry:unknown=null,screenshot=Promise.resolve();const observe=(chunk:Buffer)=>{const text=chunk.toString();process.stdout.write(text);const match=/BITPOS_U23_GEOMETRY:(\{[^\r\n]+\})/.exec(text);if(match)geometry=JSON.parse(match[1]);if(!captured&&text.includes('BITPOS_U23_ACTIVITY_VISIBLE')){captured=true;screenshot=owned(`customer-u23-avd-direct-${date}.png`);}};
 flutter.stdout.on('data',observe);flutter.stderr.on('data',observe);const [code]=await scope.wait(once(flutter,'exit'));await screenshot;assert.equal(code,0);assert.ok(captured,'U23 activity marker was not observed');assert.ok(geometry,'U23 widget geometry receipt missing');
 const persisted=(await admin.query(`SELECT s.revoked_at IS NOT NULL AS revoked,a.disabled_at IS NOT NULL AS disabled,(SELECT count(*)::int FROM bitpos.online_food_orders WHERE order_id=ANY($2::uuid[])) AS order_count,(SELECT count(*)::int FROM bitpos.online_food_orders WHERE order_id=ANY($2::uuid[]) AND account_id=$1) AS owner_count FROM bitpos.mobile_sessions s JOIN bitpos.mobile_accounts a ON a.id=s.account_id WHERE s.id=$3`,[account,orderIds,session])).rows[0];assert.deepEqual(persisted,{revoked:false,disabled:false,order_count:3,owner_count:3});
 await writeFile(`${evidence}/customer-u23-avd-direct-${date}.json`,JSON.stringify({date:'2026-10-21',status:'PASS_ACTUAL_LOCAL_ORDER_HISTORY_API_AND_ROOT_AVD',fixture:{database:'disposable loopback PostgreSQL',api:'3043',orderCreatedThrough:'three canonical mobile quote and order API submissions',merchantName,total:'USD 2.70',payment:'unpaid; no signature or settlement'},native:{device:'emulator-5554',integration:'customer_history_root_test.dart',result:'PASS',screenshot:`customer-u23-avd-direct-${date}.png`,figcraftGeometry:geometry},sql:{orderCount:3,ownedByFixtureAccount:true,sessionRevoked:false,accountDisabled:false},limits:['Synthetic disposable local fixture only','Manual screenshot review required; no automated pixel diff','No production or external provider use'],physicalTesting:'deferred_by_user_2026-10-16'},null,2)+'\n');
 console.log('PASS_U23_LOCAL_API_AND_ROOT_AVD '+orderId);
}finally{
 scope.close();
 await admin.query('UPDATE bitpos.mobile_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1',[session]).catch(()=>{});
 await admin.query('UPDATE bitpos.mobile_accounts SET disabled_at=COALESCE(disabled_at,clock_timestamp()) WHERE id=$1',[account]).catch(()=>{});
 await admin.end();
}
