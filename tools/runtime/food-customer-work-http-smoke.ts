import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
const fixture=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/dispatch066-avd-fixture-20261018.json','utf8'));
const native=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/dispatch066-avd-background-location-20261018.json','utf8'));
const base='http://127.0.0.1:3003/api/mobile/v1';
async function call(path:string,token?:string,body?:unknown){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
const tokens:string[]=[];
try{
 const customer=await call('/auth/verify',undefined,{phone:'+66900000001',code:'123456',deviceId:randomUUID()}),driver=await call('/auth/verify',undefined,{phone:'+66900000002',code:'123456',deviceId:randomUUID()});assert.equal(customer.status,200);assert.equal(driver.status,200);tokens.push(customer.body.accessToken,driver.body.accessToken);
 const path='/food/orders/'+fixture.orderId+'/delivery',own=await call(path,tokens[0]);assert.equal(own.status,200);assert.equal(own.body.shipmentId,fixture.shipmentId);assert.equal(own.body.assignment.id,native.assignment.id);assert.equal(own.body.assignment.deliveryProof,null);assert.equal('pickupProof' in own.body.assignment,false);
 assert.equal((await call(path,tokens[1])).status,404);assert.equal((await call('/food/orders/'+randomUUID()+'/delivery',tokens[0])).status,404);assert.equal((await call(path)).status,401);
 const receipt={status:'PASS',orderId:fixture.orderId,own:own.body,denials:{wrongCustomer:404,unknownOrder:404,unauthenticated:401},fixture:'Local synthetic OTP and settlement; coordinates from AVD native provider, not real GPS',physicalTesting:'deferred_by_user_2026-10-16'};await writeFile('.omp/work/flutter-delivery-20261016/evidence/dispatch067-owned-customer-http-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{for(const token of tokens)await call('/auth/logout',token,{allDevices:false});}
