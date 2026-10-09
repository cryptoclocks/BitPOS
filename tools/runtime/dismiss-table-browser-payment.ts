import 'dotenv/config';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const api='http://127.0.0.1:3001/api';
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--expired-unsigned','Only the recorded paid or interrupted unsigned order may be released');
const expiredUnsigned=process.argv[2]==='--expired-unsigned';
const proof=JSON.parse(fs.readFileSync(expiredUnsigned?'.omp/work/evidence/wire-interrupted-unsigned-order-reconciliation.json':'.omp/work/evidence/table-first-browser-payment-reconciled.json','utf8'));
if(expiredUnsigned){assert.equal(proof.rows.length,1);assert.equal(proof.rows[0].status,'EXPIRED');assert.equal(proof.rows[0].reservation_released,true);assert.equal(proof.rows[0].attempts,0);assert.equal(proof.rows[0].payments,0);assert.equal(proof.journalSignaturePresent,false);proof.orderId=proof.rows[0].id;}
const routing=JSON.parse(fs.readFileSync('.omp/work/evidence/table-demo-configuration.json','utf8'));
const user=JSON.parse(fs.readFileSync('local/private/demo-login.json','utf8')).find((u:{role:string})=>u.role==='owner');
async function request(path:string,method='GET',body?:unknown,token?:string){const r=await fetch(api+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(!r.ok)throw new Error('Safe staff receipt release refused HTTP '+r.status);return r.json();}
const session=await request('/session','POST',{email:user.email,password:user.password});
assert.equal(session.merchantId,routing.merchantId);
const order=await request('/orders/'+proof.orderId,'GET',undefined,session.token);assert.equal(order.status,expiredUnsigned?'EXPIRED':'PAID');assert.equal(order.authority.target.deviceId,routing.ids.device);
const devices=await request('/devices','GET',undefined,session.token);const target=devices.devices.find((d:{id:string})=>d.id===routing.ids.device);assert.ok(target);
if(target.screen.kind==='order'){assert.equal(target.screen.orderId,proof.orderId);await request('/registers/'+routing.ids.register+'/orders/'+proof.orderId+'/dismiss','POST',{orderVersion:order.version,screenGeneration:target.screen.screenGeneration},session.token);}else assert.equal(target.screen.kind,'idle');
const after=await request('/devices','GET',undefined,session.token);const screen=after.devices.find((d:{id:string})=>d.id===routing.ids.device).screen;assert.equal(screen.kind,'idle');
const retained=await request('/orders/'+proof.orderId,'GET',undefined,session.token);assert.equal(retained.status,order.status);assert.equal(retained.version,order.version);assert.deepEqual(retained.pricing,order.pricing);assert.deepEqual(retained.settlement,order.settlement);assert.deepEqual(retained.authority,order.authority);
const receipt={origin:'actual_owner_HTTP_safe_same_original_order_receipt_dismissal',orderId:proof.orderId,registerId:routing.ids.register,targetDevice:routing.ids.device,screen,priorPhysicalACK:expiredUnsigned?null:proof.physicalACK.event_id,retainedStatus:retained.status,paidBillUnchanged:!expiredUnsigned,retainedBillUnchanged:true,physicalFingerTouch:false,newTransactions:0};
fs.writeFileSync(expiredUnsigned?'.omp/work/evidence/table-interrupted-expired-staff-dismiss.json':'.omp/work/evidence/table-first-browser-staff-dismiss.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
