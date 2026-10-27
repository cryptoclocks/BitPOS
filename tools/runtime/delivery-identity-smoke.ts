import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {setTimeout as delay} from 'node:timers/promises';
import {Socket} from 'node:net';

// Explicit fixture-only environment; never load root .env or real OTP providers.
process.env.DOTENV_CONFIG_PATH='/dev/null';
Object.assign(process.env,{
 DATABASE_URL:'postgresql://bitpos_app@127.0.0.1:55436/bitpos_delivery_fixture',
 ADMIN_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',
 AUTH_ANON_KEY:'fixture-no-provider-key',APP_SECRET:'fixture-only-not-a-real-secret-000000',
 PUBLIC_URL:'http://127.0.0.1:4321',SOLANA_RPC:'https://api.devnet.solana.com',
 DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets',BITPOS_MOBILE_ENABLED:'1',BITPOS_MOBILE_TRUSTED_PROXIES:'127.0.0.1'
});
const authSubject=randomUUID();let providerCalls=0;
let providerMode='ok';
const provider=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const input=JSON.parse(raw);providerCalls++;
 res.setHeader('Content-Type','application/json');
 if(providerMode==='json'){res.end('{');return;}
 if(providerMode==='schema'){res.end('{}');return;}
 if(providerMode==='429'||providerMode==='500'){res.statusCode=Number(providerMode);res.end('{}');return;}
 if(providerMode==='timeout'){setTimeout(()=>res.end('{}'),11000);return;}
 if(providerMode==='mismatch'){res.end(JSON.stringify({user:{id:authSubject,phone:'+66123456789',phone_confirmed_at:new Date().toISOString()}}));return;}
 if(req.url==='/otp'){res.end('{}');return;}
 if(req.url==='/verify'&&input.token==='123456'){
  res.end(JSON.stringify({user:{id:authSubject,phone:input.phone,phone_confirmed_at:new Date().toISOString()}}));return;
 }
 res.statusCode=401;res.end('{}');
});
provider.listen(0,'127.0.0.1');await once(provider,'listening');
const providerAddress=provider.address();assert(providerAddress&&typeof providerAddress!=='string');
process.env.AUTH_URL='http://127.0.0.1:'+providerAddress.port;
// Test module-loading boundary: API config must see the ephemeral provider port
// and fixture DB before its import-time configuration/pool are initialized.
const {server}=await import('../../apps/api/src/index');
const {mobileClientAddress}=await import('../../apps/api/src/mobile-ingress');
const {pool}=await import('../../apps/api/src/db');
server.listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();assert(address&&typeof address!=='string');
const origin='http://127.0.0.1:'+address.port;
const phone='+669'+String(Date.now()).slice(-8);
const deviceId=randomUUID();let assertions=0;
let clientIp='2001:db8:'+randomUUID().slice(0,4)+'::1';
async function request(path:string, method='GET', body?:unknown, access?:string){
 const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json','x-bitpos-client-ip':clientIp,...(access?{Authorization:'Bearer '+access}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,value:await response.json()};
}
try {
 assert.equal((await request('/api/mobile/v1/auth/otp','POST',{phone})).status,200);assertions++;
 const untrustedSocket=new Socket();Object.defineProperty(untrustedSocket,'remoteAddress',{value:'203.0.113.41'});
 const untrustedRequest=new http.IncomingMessage(untrustedSocket);
 untrustedRequest.headers['x-bitpos-client-ip']='198.51.100.2';
 assert.equal(mobileClientAddress(untrustedRequest),'203.0.113.41');assertions++;
 untrustedRequest.headers['x-bitpos-client-ip']='198.51.100.3';
 assert.equal(mobileClientAddress(untrustedRequest),'203.0.113.41');assertions++;
 const missingIngress=await fetch(origin+'/api/mobile/v1/account');
 assert.equal(missingIngress.status,503);assertions++;
 assert.equal((await request('/api/mobile/v1/auth/verify','POST',{phone,code:'000000',deviceId})).status,401);assertions++;
 const login=await request('/api/mobile/v1/auth/verify','POST',{phone,code:'123456',deviceId});assert.equal(login.status,200);assertions++;
 const first=login.value;
 assert.equal((await request('/api/mobile/v1/account','GET',undefined,first.accessToken)).value.id,first.accountId);assertions++;
 assert.equal((await request('/api/orders','GET',undefined,first.accessToken)).status,401);assertions++;
 assert.equal((await request('/api/mobile/v1/auth/refresh','POST',{refreshToken:first.refreshToken,deviceId:randomUUID()})).status,401);assertions++;
 const rotation=await request('/api/mobile/v1/auth/refresh','POST',{refreshToken:first.refreshToken,deviceId});assert.equal(rotation.status,200);assertions++;
 assert.equal((await request('/api/mobile/v1/account','GET',undefined,first.accessToken)).status,401);assertions++;
 assert.equal((await request('/api/mobile/v1/account','GET',undefined,rotation.value.accessToken)).status,200);assertions++;
 assert.equal((await request('/api/mobile/v1/auth/refresh','POST',{refreshToken:first.refreshToken,deviceId})).status,401);assertions++;
 assert.equal((await request('/api/mobile/v1/account','GET',undefined,rotation.value.accessToken)).status,401);assertions++;
 const revoked=await pool.query('SELECT revoked_at FROM mobile_sessions WHERE id=$1',[first.sessionId]);assert(revoked.rows[0].revoked_at);assertions++;
 const second=(await request('/api/mobile/v1/auth/verify','POST',{phone,code:'123456',deviceId})).value;
 assert.equal(second.accountId,first.accountId);assertions++;
 assert.equal((await request('/api/mobile/v1/auth/logout','POST',{allDevices:true},second.accessToken)).status,200);assertions++;
 assert.equal((await request('/api/mobile/v1/account','GET',undefined,second.accessToken)).status,401);assertions++;
 const linked=await pool.query('SELECT count(*)::int AS n FROM members WHERE user_id=$1',[authSubject]);assert.equal(linked.rows[0].n,0);assertions++;
 const audit=await pool.query("SELECT action FROM mobile_identity_audit WHERE account_id=$1 ORDER BY id",[first.accountId]);
 assert(audit.rows.some(r=>r.action==='session.refresh_replay_revoked'));assertions++;
 const otherDevice=randomUUID();
 const third=(await request('/api/mobile/v1/auth/verify','POST',{phone,code:'123456',deviceId})).value;
 const fourth=(await request('/api/mobile/v1/auth/verify','POST',{phone,code:'123456',deviceId:otherDevice})).value;
 assert.equal((await request('/api/mobile/v1/auth/logout','POST',{allDevices:false},third.accessToken)).status,200);assertions++;
 assert.equal((await request('/api/mobile/v1/account','GET',undefined,fourth.accessToken)).status,200);assertions++;
 const fifth=(await request('/api/mobile/v1/auth/verify','POST',{phone,code:'123456',deviceId})).value;
 await request('/api/mobile/v1/auth/logout','POST',{allDevices:true},fourth.accessToken);
 assert.equal((await request('/api/mobile/v1/account','GET',undefined,fourth.accessToken)).status,401);assertions++;
 assert.equal((await request('/api/mobile/v1/account','GET',undefined,fifth.accessToken)).status,401);assertions++;
 const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
 try {
  for(const seconds of [901,900,899,60,0]){
   const session=(await request('/api/mobile/v1/auth/verify','POST',{phone:'+668'+String(Date.now()).slice(-8),code:'123456',deviceId})).value;
   await admin.query("UPDATE bitpos.mobile_sessions SET access_expires_at=clock_timestamp()-interval '1 second',refresh_expires_at=clock_timestamp()+$2*interval '1 second' WHERE id=$1",[session.sessionId,seconds]);
   const result=await request('/api/mobile/v1/auth/refresh','POST',{refreshToken:session.refreshToken,deviceId});
   assert.equal(result.status,seconds===0?401:200);assertions++;
  }
  const concurrent=(await request('/api/mobile/v1/auth/verify','POST',{phone:'+667'+String(Date.now()).slice(-8),code:'123456',deviceId})).value;
  await admin.query('BEGIN');
  await admin.query('SELECT id FROM bitpos.mobile_sessions WHERE id=$1 FOR UPDATE',[concurrent.sessionId]);
  const a=request('/api/mobile/v1/auth/refresh','POST',{refreshToken:concurrent.refreshToken,deviceId});
  const b=request('/api/mobile/v1/auth/refresh','POST',{refreshToken:concurrent.refreshToken,deviceId});
  // Database barrier: both refresh statements must be waiting on the held row.
  const deadline=Date.now()+5000;
  while(true){
   await admin.query('SELECT pg_stat_clear_snapshot()');
   const waiting=await admin.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT s.*,a.disabled_at,h.consumed_at%'");
   if(waiting.rows[0].n===2)break;
   if(Date.now()>deadline)throw Error('Concurrent refresh barrier not reached');
   await delay(5);
  }
  await admin.query('COMMIT');
  const results=await Promise.all([a,b]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);assertions++;
  const successor=results.find(r=>r.status===200)!.value;
  assert.equal((await request('/api/mobile/v1/account','GET',undefined,successor.accessToken)).status,401);assertions++;
  const replayAudit=await admin.query("SELECT count(*)::int AS n FROM bitpos.mobile_identity_audit WHERE session_id=$1 AND action='session.refresh_replay_revoked'",[concurrent.sessionId]);
  assert.equal(replayAudit.rows[0].n,1);assertions++;
 } finally {await admin.query('ROLLBACK');await admin.end();}
 for(const [mode,status] of [['json',503],['schema',503],['mismatch',401],['429',429],['500',503],['timeout',503]] as const){
  providerMode=mode;
  const result=await request('/api/mobile/v1/auth/verify','POST',{phone:'+666'+String(Date.now()).slice(-8),code:'123456',deviceId});
  assert.equal(result.status,status);assertions++;
 }
 providerMode='ok';
 const originalIp=clientIp;clientIp='2001:db8:'+randomUUID().slice(0,4)+'::2';
 for(let i=0;i<20;i++)assert.equal((await request('/api/mobile/v1/auth/otp','POST',{phone:'+665'+String(Date.now()+i).slice(-8)})).status,200);
 assert.equal((await request('/api/mobile/v1/auth/otp','POST',{phone:'+665'+String(Date.now()+100).slice(-8)})).status,429);assertions++;
 clientIp=originalIp;
 assert.equal((await request('/api/mobile/v1/auth/otp','POST',{phone:'+664'+String(Date.now()).slice(-8)})).status,200);assertions++;
 process.env.BITPOS_MOBILE_ENABLED='0';
 assert.equal((await request('/api/mobile/v1/account')).status,503);assertions++;
 const sourceFingerprint=JSON.parse(execFileSync('python3',['.omp/work/flutter-delivery-20261016/gate.py','fingerprint'],{encoding:'utf8'})).source_fingerprint;
 const receipt={scope:'flutter-delivery-20261016',scenario:'local_http_mobile_identity',executedAt:new Date().toISOString(),sourceFingerprint,fixture:true,assertions,provider:'loopback fake OTP; no SMS',providerCalls,passed:true,verified:['OTP bad-code rejection','account reuse','mobile token cannot enter merchant routes','device-bound refresh','rotation invalidates old access','refresh replay commits revocation','single/all-device logout isolation','no merchant membership','disabled admission','refresh expiry boundaries','controlled concurrent refresh replay','provider failure matrix','trusted ingress separate client rate buckets'],physical_testing:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/p0-identity-smoke.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
} finally {
 const serverClosed=once(server,'close');server.close();await serverClosed;
 const providerClosed=once(provider,'close');provider.close();await providerClosed;
 await pool.end();
}
