import test from 'node:test';
import assert from 'node:assert/strict';

test('public shortcut access requires its exact opted-in devnet origin',async()=>{
 for(const [key,value] of Object.entries({DATABASE_URL:'postgresql://fixture@127.0.0.1/fixture',ADMIN_DATABASE_URL:'postgresql://fixture@127.0.0.1/fixture',AUTH_URL:'http://127.0.0.1:18781',AUTH_ANON_KEY:'fixture',APP_SECRET:'fixture-only-secret-with-32-characters',PUBLIC_URL:'http://localhost:4321',SOLANA_RPC:'https://api.devnet.solana.com',DEVNET_PRIVATE_DIR:'/nonexistent-fixture'}))process.env[key]??=value;
 const {config}=await import('../apps/api/src/config');
 const {demoAccessEnabled}=await import('../apps/api/src/demo-auth');
 const before={url:config.PUBLIC_URL,flag:config.BITPOS_DEMO_QUICK_SIGNIN,env:process.env.NODE_ENV,origin:process.env.BITPOS_DEMO_PUBLIC_ORIGIN};
 try {
  config.BITPOS_DEMO_QUICK_SIGNIN='1';process.env.NODE_ENV='development';
  config.PUBLIC_URL='https://pos.cashlessthailand.com';
  delete process.env.BITPOS_DEMO_PUBLIC_ORIGIN;assert.equal(demoAccessEnabled(),false);
  process.env.BITPOS_DEMO_PUBLIC_ORIGIN=config.PUBLIC_URL;assert.equal(demoAccessEnabled(),true);
  config.PUBLIC_URL='https://attacker.invalid';assert.equal(demoAccessEnabled(),false);
  config.PUBLIC_URL='https://pos.cashlessthailand.com';process.env.NODE_ENV='production';assert.equal(demoAccessEnabled(),false);
 } finally {
  config.PUBLIC_URL=before.url;config.BITPOS_DEMO_QUICK_SIGNIN=before.flag;
  for(const [key,value] of Object.entries({NODE_ENV:before.env,BITPOS_DEMO_PUBLIC_ORIGIN:before.origin}))if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
