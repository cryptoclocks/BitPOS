import assert from 'node:assert/strict';
import test from 'node:test';
Object.assign(process.env,{DATABASE_URL:'postgres://x',ADMIN_DATABASE_URL:'postgres://x',AUTH_URL:'http://localhost:9',AUTH_ANON_KEY:'k',APP_SECRET:'a'.repeat(40),PUBLIC_URL:'http://localhost:3001',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/tmp/none',BITPOS_DEMO_QUICK_SIGNIN:'0'});
const {sealSecrets,openSecrets,channelConnectionsRequest}=await import('../apps/api/src/channel-connections');
const M='11111111-1111-4111-8111-111111111111',N='22222222-2222-4222-8222-222222222222';
const secrets={clientSecret:'sec-ret-1',webhookSecret:'hook-2'};

test('credentials round-trip and the ciphertext does not contain the plaintext',()=>{
 const sealed=sealSecrets(secrets,M,'grabfood','sandbox');
 assert.ok(!sealed.includes('sec-ret-1')&&!Buffer.from(sealed.split('.')[3],'base64url').toString().includes('sec-ret'));
 assert.deepEqual(openSecrets(sealed,M,'grabfood','sandbox'),secrets);
 assert.notEqual(sealed,sealSecrets(secrets,M,'grabfood','sandbox'));
});
test('ciphertext moved to another merchant, source or environment is refused',()=>{
 const sealed=sealSecrets(secrets,M,'grabfood','sandbox');
 for(const [m,s,e] of [[N,'grabfood','sandbox'],[M,'lineman','sandbox'],[M,'grabfood','production']] as const)assert.throws(()=>openSecrets(sealed,m,s,e));
});
test('only the owner may read or write credentials',async()=>{
 const db={query:async()=>{throw new Error('must not reach the database');}} as never;
 for(const role of ['manager','staff','cashier'])for(const method of ['GET','PUT','POST'])
  await assert.rejects(channelConnectionsRequest(db,M,'u',role,method,{}),(e:unknown)=>JSON.stringify(e).includes('ROLE_REQUIRED')||String(e).includes('ROLE_REQUIRED'));
});
test('the stored row is returned without secret material',async()=>{
 const calls:string[]=[];
 const db={query:async(sql:string,args:unknown[]=[])=>{calls.push(sql);
  if(sql.startsWith('SELECT'))return {rows:[]};
  if(sql.startsWith('INSERT INTO channel_connections'))return {rows:[{source:'grabfood',environment:'sandbox',state:'credentials_saved',external_store_id:args[3],client_id:args[4],secret_ciphertext:args[5],has_client_secret:args[6],has_webhook_secret:args[7],updated_at:new Date()}]};
  return {rows:[]};}} as never;
 const out=await channelConnectionsRequest(db,M,'u','owner','PUT',{source:'grabfood',environment:'sandbox',externalStoreId:'s',clientId:'c',clientSecret:'topsecret'});
 assert.ok(!JSON.stringify(out).includes('topsecret')&&!('secret_ciphertext' in out));
 assert.equal((out as {hasClientSecret:boolean}).hasClientSecret,true);
});
test('unknown fields and unknown providers are rejected',async()=>{
 const db={query:async()=>({rows:[]})} as never;
 await assert.rejects(channelConnectionsRequest(db,M,'u','owner','PUT',{source:'ubereats',environment:'sandbox',externalStoreId:'',clientId:''}));
 await assert.rejects(channelConnectionsRequest(db,M,'u','owner','PUT',{source:'grabfood',environment:'sandbox',externalStoreId:'',clientId:'',extra:1}));
});

const {setActiveEnvironment,testChannelConnection}=await import('../apps/api/src/channel-connections');
test('production needs an explicit owner confirmation and stored production credentials',async()=>{
 const writes:unknown[][]=[];
 const db=(has:boolean)=>({query:async(sql:string,a:unknown[]=[])=>{if(sql.startsWith('SELECT 1'))return {rowCount:has?1:0,rows:[]};writes.push(a);return {rows:[],rowCount:1};}}) as never;
 await assert.rejects(setActiveEnvironment(db(true),M,'u','owner',{source:'grabfood',environment:'production'}));
 await assert.rejects(setActiveEnvironment(db(false),M,'u','owner',{source:'grabfood',environment:'production',confirmProduction:true}));
 await assert.rejects(setActiveEnvironment(db(true),M,'u','manager',{source:'grabfood',environment:'sandbox'}));
 assert.deepEqual(await setActiveEnvironment(db(true),M,'u','owner',{source:'grabfood',environment:'production',confirmProduction:true}),{source:'grabfood',activeEnvironment:'production'});
 assert.deepEqual(await setActiveEnvironment(db(false),M,'u','owner',{source:'grabfood',environment:'sandbox'}),{source:'grabfood',activeEnvironment:'sandbox'});
});
test('test connection uses the stored secret, marks linked only when the provider accepts, and records failures',async()=>{
 const sealed=sealSecrets(secrets,M,'grabfood','sandbox');
 const updates:unknown[][]=[];
 const db={query:async(sql:string,a:unknown[]=[])=>{
  if(sql.startsWith('SELECT * FROM channel_connections'))return {rows:[{client_id:'cid',external_store_id:'M-1',secret_ciphertext:sealed}]};
  if(sql.startsWith('UPDATE channel_connections'))updates.push(a);return {rows:[],rowCount:1};}} as never;
 const seen:unknown[]=[];
 const http=(status:number)=>async(url:string,init:{body?:string})=>{seen.push(init.body?JSON.parse(init.body):url);
  const body=url.includes('oauth2')?{access_token:'t'}:{isOpen:true,closeReason:''};
  return {status:url.includes('oauth2')?200:status,headers:{get:()=>null},text:async()=>JSON.stringify(body)};};
 const good=await testChannelConnection(db,M,'u','owner',{source:'grabfood',environment:'sandbox'},http(200) as never);
 assert.equal(good.ok,true);assert.equal(good.state,'linked');
 assert.equal((seen[0] as {client_secret:string}).client_secret,'sec-ret-1');
 const bad=await testChannelConnection(db,M,'u','owner',{source:'grabfood',environment:'sandbox'},http(403) as never);
 assert.deepEqual([bad.ok,bad.state,bad.result],[false,'credentials_saved','GRAB_FORBIDDEN']);
 assert.deepEqual(updates.map(u=>u[3]),['linked','credentials_saved']);
 await assert.rejects(testChannelConnection(db,M,'u','owner',{source:'lineman',environment:'sandbox'},http(200) as never));
 await assert.rejects(testChannelConnection(db,M,'u','manager',{source:'grabfood',environment:'sandbox'},http(200) as never));
});
