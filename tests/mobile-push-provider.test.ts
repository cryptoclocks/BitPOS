import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createMobilePushProvider,mobilePushProviderConfig} from '../apps/worker/src/mobile-push-provider';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const credentials=JSON.stringify({type:'service_account',project_id:'bitpos-fixture',client_email:'fixture@bitpos-fixture.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
const config={kind:'fcm',projectId:'bitpos-fixture',credentialsPath:'/synthetic-fixture.json'} as const;
const message={fid:'synthetic-firebase-installation-id',eventId:'00000000-0000-4000-8000-000000000087',expiresAt:'2099-01-01T00:00:00.000Z',bindingId:'00000000-0000-4000-8000-000000000088',bindingGeneration:'2',app:'CUSTOMER',locale:'en'} as const;
const oauth=()=>Response.json({access_token:'synthetic-access',expires_in:3600,token_type:'Bearer'});
test('unconfigured transport does not read credentials or contact provider',async()=>{
 const provider=createMobilePushProvider(mobilePushProviderConfig({}),{fetch:async()=>{assert.fail('No configured network authority');},readCredentials:async()=>{assert.fail('No configured credentials authority');}});
 assert.deepEqual(await provider.send(message),{status:'UNAVAILABLE',retryAfterSeconds:300});
 assert.throws(()=>mobilePushProviderConfig({BITPOS_PUSH_FCM_PROJECT_ID:'bitpos-fixture'}),/INVALID_MOBILE_PUSH_CONFIGURATION/);
});
test('credentials for another Firebase project cannot mint a token or send',async()=>{
 let contacted=false;const provider=createMobilePushProvider(config,{readCredentials:async()=>credentials.replace('"project_id":"bitpos-fixture"','"project_id":"foreign-fixture"'),fetch:async()=>{contacted=true;return oauth();}});
 assert.equal((await provider.send(message)).status,'UNAVAILABLE');assert.equal(contacted,false);
});
test('only explicit UNREGISTERED retires a device token, not generic payload errors',async()=>{
 for(const [error,status] of [[{error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}},'TOKEN_INVALID'],[{error:{status:'INVALID_ARGUMENT'}},'RETRY']] as const){
  const provider=createMobilePushProvider(config,{readCredentials:async()=>credentials,fetch:async url=>String(url).includes('oauth2.googleapis.com')?oauth():Response.json(error,{status:400})});
  assert.equal((await provider.send(message)).status,status);
 }
});
test('oversized successful provider body cannot become a delivery acceptance',async()=>{
 const provider=createMobilePushProvider(config,{readCredentials:async()=>credentials,fetch:async url=>String(url).includes('oauth2.googleapis.com')?oauth():new Response('x'.repeat(32769),{status:200})});
 assert.equal((await provider.send(message)).status,'UNAVAILABLE');
});
test('unauthorized send invalidates cached OAuth authority before the next attempt',async()=>{
 let authentications=0,sends=0;const provider=createMobilePushProvider(config,{readCredentials:async()=>credentials,fetch:async url=>{if(String(url).includes('oauth2.googleapis.com')){authentications++;return oauth();}sends++;return sends===1?new Response('',{status:401}):Response.json({name:'projects/bitpos-fixture/messages/fixture-accepted'});}});
 assert.equal((await provider.send(message)).status,'UNAVAILABLE');assert.equal((await provider.send(message)).status,'ACCEPTED');assert.equal(authentications,2);
});
test('authority lost during OAuth prevents the subsequent provider message request',async()=>{
 let authenticated=false,messages=0,checks=0;
 const provider=createMobilePushProvider(config,{readCredentials:async()=>credentials,fetch:async(url)=>{
  if(String(url).includes('oauth2.googleapis.com')){authenticated=true;return oauth();}
  messages++;return Response.json({name:'projects/bitpos-fixture/messages/should-not-send'});
 }});
 const result=await provider.send(message,undefined,async()=>{checks++;assert.equal(authenticated,true);return false;});
 assert.deepEqual(result,{status:'UNAVAILABLE',retryAfterSeconds:300});assert.equal(checks,1);assert.equal(messages,0);
});
test('canonical expiry bounds remaining transport retention after OAuth and rejects already expired work without I/O',async()=>{
 let clock=Date.parse('2026-10-19T00:00:00.000Z'),requests=0,payload:any;
 const expiresAt=new Date(clock+3000).toISOString();
 const provider=createMobilePushProvider(config,{now:()=>clock,readCredentials:async()=>credentials,fetch:async(url,init)=>{
  requests++;if(String(url).includes('oauth2.googleapis.com')){clock+=1500;return oauth();}
  payload=JSON.parse(String(init?.body));return Response.json({name:'projects/bitpos-fixture/messages/fixture.id'});
 }});
 assert.equal((await provider.send({...message,expiresAt})).status,'ACCEPTED');
 assert.equal(payload.message.android.ttl,'1s');assert.ok(Number(payload.message.apns.headers['apns-expiration'])*1000<=Date.parse(expiresAt));
 clock=Date.parse(expiresAt);assert.equal((await provider.send({...message,expiresAt})).status,'UNAVAILABLE');assert.equal(requests,2);
});
