import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'};
test('demo session HTTP refuses disabled production and untrusted-origin access before authentication',integration,async()=>{
 const {config}=await import('../apps/api/src/config');const {server}=await import('../apps/api/src/index');const {pool}=await import('../apps/api/src/db');
 const priorFlag=config.BITPOS_DEMO_QUICK_SIGNIN,priorEnvironment=process.env.NODE_ENV;
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 async function post(origin='http://127.0.0.1:4321',input:unknown={role:'owner'}){return fetch(base+'/api/demo-session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});}
 try{
  config.BITPOS_DEMO_QUICK_SIGNIN='0';assert.equal((await post()).status,404);assert.deepEqual(await (await fetch(base+'/api/demo-session')).json(),{enabled:false,roles:[]});
  config.BITPOS_DEMO_QUICK_SIGNIN='1';process.env.NODE_ENV='production';assert.equal((await post()).status,404);assert.deepEqual(await (await fetch(base+'/api/demo-session')).json(),{enabled:false,roles:[]});
  process.env.NODE_ENV='development';const foreign=await post('https://attacker.invalid');assert.equal(foreign.status,403);assert.equal((await foreign.json()).error.code,'AUTH_REQUIRED');
  assert.equal((await post('http://127.0.0.1:4321',{role:'owner',merchantId:'11111111-1111-4111-8111-111111111111'})).status,422);
 }finally{config.BITPOS_DEMO_QUICK_SIGNIN=priorFlag;if(priorEnvironment===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=priorEnvironment;await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();}
});
