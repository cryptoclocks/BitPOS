import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3008/api/mobile/v1/';
async function login(phone:string){const response=await fetch('http://127.0.0.1:3007/api/mobile/v1/auth/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,code:'123456',deviceId:crypto.randomUUID()})});assert.equal(response.status,200);return response.json();}
const driver=await login('+66900000002'),customer=await login('+66900000001');
async function request(path:string,token?:string,body?:unknown,method=body?'PUT':'GET'){return fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
try{
 assert.equal((await request('driver/food/discovery')).status,401);
 const before=await request('driver/food/discovery',driver.accessToken);assert.equal(before.status,200);const snapshot=await before.json();assert.ok(Array.isArray(snapshot.services));
 const command={idempotencyKey:crypto.randomUUID(),expectedVersion:snapshot.consent?.revision??'0',enabled:false,zones:[]};
 const changed=await request('driver/food/discovery',driver.accessToken,command);assert.equal(changed.status,200);const result=await changed.json();assert.equal(result.enabled,false);
 const repeated=await request('driver/food/discovery',driver.accessToken,command);assert.equal(repeated.status,200);assert.deepEqual(await repeated.json(),result);
 const recovered=await request('driver/food/discovery',driver.accessToken);assert.equal(recovered.status,200);const current=await recovered.json();assert.equal(current.consent.revision,result.revision);assert.equal(current.consent.ownedBySession,true);assert.equal(current.consent.location,null);
 const foreign=await request('driver/food/discovery',customer.accessToken);assert.equal(foreign.status,200);assert.equal((await foreign.json()).consent,null);
 assert.equal((await request('driver/food/discovery?driverId=00000000-0000-4000-8000-000000000001',driver.accessToken)).status,422);
 assert.equal((await request('driver/food/discovery/location',driver.accessToken,{revision:result.revision,sequence:'1',capturedAt:new Date().toISOString(),latitudeE7:137560000,longitudeE7:1005018000,accuracyMm:5000},'POST')).status,409);
 const receipt={status:'PASS_BOUNDED_PRIVATE_DISCOVERY_HTTP',actualApi:'127.0.0.1:3008',fixture:true,checks:['Unauthenticated read denied','Own snapshot','Persisted explicit disabled consent','Exact retry same receipt','Fresh HTTP snapshot recovers committed revision','Different customer cannot read driver consent','No target-driver query override','Disabled consent location upload denied'],limits:['Actual HTTP and committed consent only; no native idle stream/automatic dispatch/provider/concurrency acceptance'],physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch071-idle-http-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{for(const actor of [driver,customer]){const response=await fetch('http://127.0.0.1:3007/api/mobile/v1/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+actor.accessToken,'Content-Type':'application/json'},body:JSON.stringify({allDevices:false})});assert.equal(response.status,200);}}
