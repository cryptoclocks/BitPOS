import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3007/api/mobile/v1/',order='18c92189-0750-45d9-9136-9ab005b2ca69';
async function post(path:string,body:unknown,token?:string){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();}
const customer=await post('auth/verify',{phone:'+66900000001',code:'123456',deviceId:randomUUID()}),other=await post('auth/verify',{phone:'+66900000002',code:'123456',deviceId:randomUUID()});
const path=`food/orders/${order}/delivery/navigation`,fence=`?assignmentId=${randomUUID()}&generation=1&leaseGeneration=1`;
async function get(token:string,suffix=fence){return fetch(base+path+suffix,{headers:{Authorization:'Bearer '+token}});}
try{
 const terminal=await get(customer.accessToken);assert.equal(terminal.status,200);const result=await terminal.json();assert.equal(result.assignment,null);assert.equal(result.route,null);assert.equal(result.routeUnavailable,'no_assignment');assert.equal(result.tilesAvailable,false);
 assert.equal((await get(customer.accessToken,'')).status,422);assert.equal((await get(customer.accessToken,fence+'&generation=2')).status,422);
 assert.equal((await get(other.accessToken)).status,404);
 await post('auth/logout',{allDevices:false},customer.accessToken);assert.equal((await get(customer.accessToken)).status,401);
 const receipt={status:'PASS_BOUNDED_NAVIGATION_TERMINAL_AUTHORITY',fixture:true,checks:['Actual disposable persisted terminal shipment has no invented route','Required and duplicate generation parameters denied','Foreign owner denied','Revoked bearer denied'],limits:['Assigned-job route and tile integration not yet exercised','Not navigation completion or physical proof'],physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/navigation070-terminal-smoke-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await post('auth/logout',{allDevices:false},other.accessToken);}
