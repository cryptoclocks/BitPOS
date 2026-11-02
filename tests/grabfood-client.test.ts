import assert from 'node:assert/strict';
import test from 'node:test';
import {GrabFoodClient,GrabError,GRAB_HOSTS} from '../apps/api/src/channels/grabfood-client';

// FAKE Grab: requests are checked against the shapes in Grab's official SDK. This is NOT evidence from Grab's sandbox.
type Call={method:string;url:string;headers:Record<string,string>;body:unknown};
function fake(handler:(c:Call)=>{status:number;body?:unknown;headers?:Record<string,string>}|'throw'){
 const calls:Call[]=[];
 const http=async(url:string,init:{method:string;headers:Record<string,string>;body?:string})=>{
  const c={method:init.method,url,headers:init.headers,body:init.body?JSON.parse(init.body):undefined};calls.push(c);
  const r=handler(c);if(r==='throw')throw new Error('reset');
  return {status:r.status,headers:{get:(n:string)=>r.headers?.[n.toLowerCase()]??null},text:async()=>r.body===undefined?'':JSON.stringify(r.body)};
 };
 return {calls,http};
}
const creds={clientId:'cid',clientSecret:'csec',merchantId:'M-1'};
const ok=(c:Call)=>c.url.endsWith('/oauth2/token')?{status:200,body:{access_token:'tok',token_type:'Bearer',expires_in:604799}}:{status:200,body:{isOpen:true,closeReason:'',orders:[],more:false}};

test('token request matches the official SDK contract and is reused',async()=>{
 const f=fake(ok),g=new GrabFoodClient('sandbox',creds,f.http);
 await g.storeStatus();await g.storeStatus();
 const t=f.calls.filter(c=>c.url.includes('oauth2'));assert.equal(t.length,1);
 assert.equal(t[0].url,'https://api.grab.com/grabid/v1/oauth2/token');
 assert.deepEqual(t[0].body,{client_id:'cid',client_secret:'csec',grant_type:'client_credentials',scope:'food.partner_api'});
 assert.equal(f.calls[1].url,'https://partner-api.grab.com/grabfood-sandbox/partner/v1/merchants/M-1/store/status');
 assert.equal(f.calls[1].headers.Authorization,'Bearer tok');
});
test('production uses the production host only when asked',async()=>{
 const f=fake(ok);await new GrabFoodClient('production',creds,f.http).storeStatus();
 assert.ok(f.calls[1].url.startsWith(GRAB_HOSTS.production+'/partner'));assert.ok(!f.calls[1].url.includes('sandbox'));
});
test('list, accept, ready and cancel send the documented requests',async()=>{
 const f=fake(ok),g=new GrabFoodClient('sandbox',creds,f.http);
 await g.listOrders({date:'2026-10-31',page:1});await g.listOrders({orderIds:['a','b']});
 await g.acceptOrReject('o1','Accepted');await g.markReady('o1');await g.cancel('o1',1001);
 const u=f.calls.filter(c=>!c.url.includes('oauth2'));
 assert.equal(u[0].url.split('/grabfood-sandbox')[1],'/partner/v1/orders?merchantID=M-1&date=2026-10-31&page=1');
 assert.equal(u[1].url.split('/grabfood-sandbox')[1],'/partner/v1/orders?merchantID=M-1&orderIDs=a&orderIDs=b');
 assert.deepEqual([u[2].method,u[2].url.split('/grabfood-sandbox')[1],u[2].body],['POST','/partner/v1/order/prepare',{orderID:'o1',toState:'Accepted'}]);
 assert.deepEqual([u[3].method,u[3].url.split('/grabfood-sandbox')[1],u[3].body],['POST','/partner/v1/orders/mark',{orderID:'o1',markStatus:1}]);
 assert.deepEqual([u[4].method,u[4].url.split('/grabfood-sandbox')[1],u[4].body],['PUT','/partner/v1/order/cancel',{orderID:'o1',merchantID:'M-1',cancelCode:1001}]);
});
test('401 drops the token and retries once; a second 401 is an auth error',async()=>{
 let n=0;const f=fake(c=>c.url.includes('oauth2')?{status:200,body:{access_token:'t'+(++n),expires_in:100000}}:{status:401});
 await assert.rejects(new GrabFoodClient('sandbox',creds,f.http).storeStatus(),(e:unknown)=>e instanceof GrabError&&e.kind==='auth');
 assert.equal(n,2);
});
test('429, 5xx and 4xx are classified; secrets never appear in errors',async()=>{
 const kinds=async(status:number,headers?:Record<string,string>)=>{const f=fake(c=>c.url.includes('oauth2')?{status:200,body:{access_token:'tok'}}:{status,headers});
  try{await new GrabFoodClient('sandbox',creds,f.http).storeStatus();}catch(e){return e as GrabError;}throw new Error('no error');};
 const r=await kinds(429,{'retry-after':'7'});assert.deepEqual([r.kind,r.retryAfterSeconds],['rate_limited',7]);
 assert.equal((await kinds(503)).kind,'server');assert.equal((await kinds(400)).kind,'rejected');assert.equal((await kinds(403)).kind,'forbidden');
 const bad=fake(()=>({status:401}));
 try{await new GrabFoodClient('sandbox',creds,bad.http).storeStatus();}catch(e){assert.ok(!String((e as Error).message).includes('csec'));}
});
test('a write that times out is reported as unknown_outcome, never auto-retried',async()=>{
 const f=fake(c=>c.url.includes('oauth2')?{status:200,body:{access_token:'tok'}}:'throw');
 await assert.rejects(new GrabFoodClient('sandbox',creds,f.http).acceptOrReject('o1','Accepted'),(e:unknown)=>e instanceof GrabError&&e.kind==='unknown_outcome');
 assert.equal(f.calls.filter(c=>c.url.includes('order/prepare')).length,1);
});
test('a read that fails to connect is a retryable network error',async()=>{
 const f=fake(c=>c.url.includes('oauth2')?{status:200,body:{access_token:'tok'}}:'throw');
 await assert.rejects(new GrabFoodClient('sandbox',creds,f.http).listOrders({date:'d',page:1}),(e:unknown)=>e instanceof GrabError&&e.kind==='network');
});
