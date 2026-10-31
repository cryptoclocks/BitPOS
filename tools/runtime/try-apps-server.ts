// LOCAL-ONLY "try the apps by hand" stack: synthetic OTP provider + API on 0.0.0.0, bound to the disposable
// database bitpos_try_fixture on the local 55440 cluster. Never a production path: it fixes its own config,
// refuses any other database, and the OTP provider only knows the synthetic fixture code. See docs/TRY_APPS_LOCAL_TH.md.
import http from 'node:http';
import {createHash} from 'node:crypto';
process.env.DOTENV_CONFIG_PATH='/dev/null';
// Emulator/phone HTTP clients reuse idle sockets; keep them alive longer than the 5s Node default.
const listen=http.Server.prototype.listen;
http.Server.prototype.listen=function(this:http.Server,...args:unknown[]){this.keepAliveTimeout=120000;this.headersTimeout=125000;return (listen as (...a:unknown[])=>http.Server).apply(this,args);} as typeof http.Server.prototype.listen;
const DB=process.env.BITPOS_TRY_DB??'bitpos_try_fixture',DB_PORT=55440,AUTH_PORT=Number(process.env.BITPOS_TRY_AUTH_PORT??'3044'),API_PORT=Number(process.env.BITPOS_TRY_API_PORT??'3043');
if(!['bitpos_try_fixture','bitpos_fix_fixture'].includes(process.env.BITPOS_TRY_DB??'bitpos_try_fixture'))throw Error('Refusing database '+process.env.BITPOS_TRY_DB);
export const FIXTURE_CODE='123456';
Object.assign(process.env,{
 DATABASE_URL:`postgresql://bitpos_app@127.0.0.1:${DB_PORT}/${DB}`,
 ADMIN_DATABASE_URL:`postgresql://cryptoclock@127.0.0.1:${DB_PORT}/${DB}`,
 AUTH_URL:`http://127.0.0.1:${AUTH_PORT}`,AUTH_ANON_KEY:'fixture-no-provider-key',
 APP_SECRET:'try-apps-fixture-only-not-a-real-secret-00000',PUBLIC_URL:'http://127.0.0.1:4321',
 SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-try-no-wallets',
 BITPOS_MOBILE_ENABLED:'1',BITPOS_MOBILE_TRUSTED_PROXIES:''
});
const userId=(phone:string)=>{const h=createHash('sha1').update('bitpos-try-fixture:'+phone).digest('hex');return `fa${h.slice(0,6)}-${h.slice(6,10)}-4${h.slice(10,13)}-8${h.slice(13,16)}-${h.slice(16,28)}`;};
const provider=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
 console.log(`[auth] ${req.method} ${req.url} phone=${body.phone??'-'}`);
 if(req.url==='/otp'){res.end('{"fixture":true}');return;}
 if(req.url==='/token?grant_type=password'&&body.email==='merchant@bitpos.invalid'&&body.password==='local-fixture-only'){
  res.end(JSON.stringify({user:{id:'fa000000-0000-4000-8000-000000000010'}}));return;
 }
 if(req.url==='/verify'&&body.token===FIXTURE_CODE&&/^\+66\d{9}$/.test(String(body.phone))){
  res.end(JSON.stringify({user:{id:userId(body.phone),phone:body.phone,phone_confirmed_at:'2026-10-16T00:00:00Z'}}));return;
 }
 res.statusCode=401;res.end('{}');
});
provider.listen(AUTH_PORT,'127.0.0.1');
const {server}=await import('../../apps/api/src/index');
const {default:pg}=await import('pg');
const admin=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await admin.connect();
const name=(await admin.query('SELECT current_database() n')).rows[0].n;
if(name!==DB)throw Error('Refusing to run against '+name);
// Convenience for hand testing only: the per-phone OTP rate limit (5/hour) would lock a human out.
setInterval(()=>{admin.query('DELETE FROM bitpos.mobile_auth_limits').catch(()=>undefined);},60000).unref();
server.on('request',(req)=>{console.log(`[api] ${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${(req.url??'').split('?')[0]}`);});
server.listen(API_PORT,'0.0.0.0',()=>console.log(`BitPOS TRY-APPS fixture API ready on 0.0.0.0:${API_PORT}; synthetic OTP ${FIXTURE_CODE} on 127.0.0.1:${AUTH_PORT}; db ${DB}`));
