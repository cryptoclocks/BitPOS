import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const journal='local/private/idle-table-preemption.json';
const routing=JSON.parse(fs.readFileSync('.omp/work/evidence/table-demo-configuration.json','utf8'));
const state=fs.existsSync(journal)?JSON.parse(fs.readFileSync(journal,'utf8')):{protocolVersion:2,registerId:routing.ids.register,deviceId:routing.ids.device,idempotencyKey:'idle-table-preemption-'+randomUUID()};
assert.equal(state.protocolVersion,2);assert.equal(state.registerId,routing.ids.register);assert.equal(state.deviceId,routing.ids.device);
function save(){fs.writeFileSync(journal,JSON.stringify(state,null,2)+'\n',{mode:0o600});}save();
const credentials=JSON.parse(fs.readFileSync('local/private/demo-login.json','utf8')).find(x=>x.role==='owner');
async function request(path,body,token){const response=await fetch('http://127.0.0.1:3001/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,200,'API '+path.split('/')[1]+' rejected request: '+String(value.error?.code||'UNAVAILABLE'));return value;}
const session=await request('/session',{email:credentials.email,password:credentials.password});assert.equal(session.merchantId,routing.merchantId);
if(!state.draft){const menu=await request('/menu',undefined,session.token);const product=menu.products.find(x=>x.nameEn==='Espresso'&&x.available>0&&x.unitPrice);assert.ok(product);state.draft={items:[{productId:product.id,qty:1}],serving:{kind:'table',tableId:routing.ids.table}};save();}
if(!state.quote){state.quote=await request('/registers/'+state.registerId+'/quotes',state.draft,session.token);save();}
const create={...state.draft,quoteId:state.quote.id,priceVersion:state.quote.priceVersion,idempotencyKey:state.idempotencyKey};
const started=new Date().toISOString();
state.order=await request('/registers/'+state.registerId+'/orders',create,session.token);save();
const repeated=await request('/registers/'+state.registerId+'/orders',create,session.token);assert.equal(repeated.id,state.order.id);assert.equal(state.order.authority.target.deviceId,state.deviceId);
const evidence={origin:'actual_register_api_table_order_physical_preemption_smoke',protocolVersion:2,startedAt:started,orderId:state.order.id,status:state.order.status,settlement:state.order.settlement,authority:state.order.authority,idempotent_retry_same_order:true,payment_submitted:false,scope:'Real paired table order only; correlate physical serial ACK and framebuffer separately. This leaves the actual order active; no paid, mobile, or finger-touch claim.'};
fs.writeFileSync('.omp/work/evidence/idle-table-preemption-order.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
