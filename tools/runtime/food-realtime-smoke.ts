import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:3005/api/mobile/v1/';
const orderId=process.argv[2]??'18c92189-0750-45d9-9136-9ab005b2ca69';
assert.match(orderId,/^[0-9a-f-]{36}$/);
async function request(path:string,body:unknown,token?:string){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});assert.equal(response.status,200,path);return response.json();}
async function login(phone:string){return request('auth/verify',{phone,code:'123456',deviceId:randomUUID()});}
async function open(token:string,cursor?:string,path=`food/orders/${orderId}/delivery/events`){const abort=new AbortController();const response=await fetch(base+path,{headers:{Authorization:'Bearer '+token,...(cursor?{'Last-Event-ID':cursor}:{})},signal:abort.signal});return {abort,response};}
async function frame(reader:ReadableStreamDefaultReader<Uint8Array>){let text='';const decoder=new TextDecoder();while(!text.includes('\n\n')){const chunk=await Promise.race([reader.read(),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('Frame deadline')),8000))]);if(chunk.done)throw Error('Unexpected stream EOF');text+=decoder.decode(chunk.value,{stream:true});assert.ok(text.length<65536);}return text;}
const customer=await login('+66900000001'),other=await login('+66900000002');
const streams:Awaited<ReturnType<typeof open>>[]=[];
try{
 const first=await open(customer.accessToken);streams.push(first);assert.equal(first.response.status,200);assert.equal(first.response.headers.get('content-type'),'text/event-stream');
 const reader=first.response.body!.getReader(),text=await frame(reader);assert.ok(text.includes('event: snapshot'));
 const snapshot=JSON.parse(text.split('\ndata: ')[1].split('\n')[0]);assert.equal(snapshot.work.shipmentId.length,36);assert.match(snapshot.cursor,/^f1_[A-Za-z0-9_-]{43}$/);
 const recovery=await open(customer.accessToken,snapshot.cursor);streams.push(recovery);assert.equal(recovery.response.status,200);const recovered=await frame(recovery.response.body!.getReader());assert.ok(recovered.includes('event: snapshot'));assert.equal(JSON.parse(recovered.split('\ndata: ')[1].split('\n')[0]).cursor,snapshot.cursor);
 const invalid=await open(customer.accessToken,'bad-cursor');streams.push(invalid);assert.equal(invalid.response.status,400);
 const denied=await open(other.accessToken);streams.push(denied);assert.notEqual(denied.response.status,200);
 await request('auth/logout',{allDevices:false},customer.accessToken);
 const revoked=await frame(reader);assert.ok(revoked.includes('event: clear'));assert.ok(!revoked.includes('latitudeE7'));
 const receipt={status:'PASS_BOUNDED_HTTP_REALTIME',fixture:true,orderId,checks:['Authenticated current persisted customer projection','Equal cursor reconnect replaces snapshot','Malformed cursor denied','Wrong account denied','Revocation clears established private stream without location'],physicalTesting:'deferred_by_user_2026-10-16',limits:['No actual GPS/provider/map or joined AVD acceptance','No full-platform completion']};
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/realtime069-http-20261018.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{for(const stream of streams)stream.abort.abort();await request('auth/logout',{allDevices:false},other.accessToken);}
