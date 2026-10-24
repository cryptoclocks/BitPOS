import http from 'node:http';
// Local development provider, never a fallback in production. No dotenv/private keys.
process.env.DOTENV_CONFIG_PATH='/dev/null';
const fixtureDatabase=process.env.BITPOS_FIXTURE_DATABASE_NAME??'bitpos_delivery_fixture';
if(!['bitpos_delivery_fixture','bitpos_w01_fixture'].includes(fixtureDatabase))throw Error('Invalid fixture database name');
const fixtureDbPort=Number(process.env.BITPOS_DELIVERY_FIXTURE_DB_PORT??'55436');
const fixtureAuthPort=Number(process.env.BITPOS_FIXTURE_AUTH_PORT??'55437');
const fixtureApiPort=Number(process.env.BITPOS_FIXTURE_API_PORT??'3001');
for(const [name,port] of [['DB',fixtureDbPort],['auth',fixtureAuthPort],['API',fixtureApiPort]] as const)if(!Number.isInteger(port)||port<1024||port>65535)throw Error(`Invalid fixture ${name} port`);
Object.assign(process.env,{
 DATABASE_URL:`postgresql://bitpos_app@127.0.0.1:${fixtureDbPort}/${fixtureDatabase}`,
 ADMIN_DATABASE_URL:`postgresql://cryptoclock@127.0.0.1:${fixtureDbPort}/${fixtureDatabase}`,
 AUTH_URL:`http://127.0.0.1:${fixtureAuthPort}`,AUTH_ANON_KEY:'fixture-no-provider-key',
 APP_SECRET:'fixture-only-not-a-real-secret-000000',PUBLIC_URL:'http://127.0.0.1:4321',
 SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/bitpos-delivery-no-wallets',
 BITPOS_MOBILE_ENABLED:'1',BITPOS_MOBILE_TRUSTED_PROXIES:''
});
const provider=http.createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw||'{}');res.setHeader('Content-Type','application/json');
 if(req.url==='/otp'){res.end('{"fixture":true}');return;}
 if(req.url==='/token?grant_type=password'&&body.email==='merchant@bitpos.invalid'&&body.password==='local-fixture-only'){
  res.end(JSON.stringify({user:{id:'fa000000-0000-4000-8000-000000000010'}}));return;
 }
 if(req.url==='/verify'&&body.token==='123456'&&['+66900000001','+66900000002'].includes(body.phone)){
  res.end(JSON.stringify({user:{id:body.phone==='+66900000001'?'fa000000-0000-4000-8000-000000000001':'fa000000-0000-4000-8000-000000000002',phone:body.phone,phone_confirmed_at:'2026-10-16T00:00:00Z'}}));return;
 }
 res.statusCode=401;res.end('{}');
});
if(!process.argv.includes('--api-only'))provider.listen(fixtureAuthPort,'127.0.0.1');
// Test module-loading boundary: install fixed local config before API import.
if(!process.argv.includes('--auth-only')){
 const {server}=await import('../../apps/api/src/index');
 server.listen(fixtureApiPort,'127.0.0.1',()=>console.log(`BitPOS local FIXTURE API ready on 127.0.0.1:${fixtureApiPort}; synthetic auth only; no SMS/payment`));
}else console.log(`BitPOS local synthetic auth only on 127.0.0.1:${fixtureAuthPort}; no SMS/payment; existing API preserved`);
