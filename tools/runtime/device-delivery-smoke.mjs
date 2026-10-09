import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
const api=process.env.BITPOS_API_URL||'http://127.0.0.1:3001/api';
const count=Number(process.env.BITPOS_DELIVERY_ROUNDS||1);assert.ok(Number.isInteger(count)&&count>=1&&count<=30);
const tag=process.env.BITPOS_DELIVERY_TAG||'bill12';assert.match(tag,/^[a-z0-9-]{1,32}$/);
const path=`local/private/device-delivery-${tag}.json`;
const state=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):{runId:crypto.randomUUID(),orders:[]};
const save=()=>fs.writeFileSync(path,JSON.stringify(state,null,2)+'\n',{mode:0o600});save();
async function request(route,body,token){const response=await fetch(api+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert.ok(response.ok,'Delivery fixture API failed');return response.json();}
const credentials=JSON.parse(fs.readFileSync('local/private/demo-login.json','utf8'))[0];
const session=await request('/session',{email:credentials.email,password:credentials.password});
const menu=await request('/menu',undefined,session.token);assert.equal(menu.products.length,12);
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
try {
 for(let i=0;i<count;i++){
  let round=state.orders[i];if(!round){round={index:i+1,idempotencyKey:state.runId+'-'+i};state.orders.push(round);save();}
  const items=i===0&&tag==='bill12'?menu.products.map(p=>({productId:p.id,qty:1})):[{productId:menu.products[0].id,qty:1}];
  if(!round.order){round.order=await request('/orders',{items,idempotencyKey:round.idempotencyKey},session.token);save();}
  assert.equal(round.order.thbMinor,round.order.items.reduce((s,x)=>s+BigInt(x.unitMinor)*BigInt(x.qty),0n).toString());
  const deadline=Date.now()+15000;let receipt;
  while(Date.now()<deadline){receipt=(await db.query("SELECT e.id AS event_id,e.payload->'display' AS display,d.latency_ms,d.rendered_at FROM bitpos.outbox_events e JOIN bitpos.device_deliveries d ON d.event_id=e.id WHERE e.order_id=$1 AND e.order_version=1 AND d.terminal_id='terminal-1' AND d.rendered_at IS NOT NULL",[round.order.id])).rows[0];if(receipt)break;await new Promise(r=>setTimeout(r,100));}
  assert.ok(receipt,'Physical bill render ACK required');assert.ok(!JSON.stringify(receipt.display).includes(credentials.email));
  if(i===0&&tag==='bill12'){assert.equal(round.order.items.length,12);assert.equal(receipt.display.items.length,6);assert.equal(receipt.display.items[5],'+ 7 more items');}
  round.receipt=receipt;save();console.log(JSON.stringify({round:round.index,orderId:round.order.id,itemCount:round.order.items.length,thbMinor:round.order.thbMinor,display:receipt.display,latency_ms:receipt.latency_ms,fixture:'Actual API/physical device delivery; no wallet/payment/sponsor use'}));
 }
}finally{await db.end();}
fs.writeFileSync(`.omp/work/evidence/device-delivery-${tag}.json`,JSON.stringify({origin:'actual_api_physical_esp32_delivery',not_payment_latency_acceptance:true,transactions_created:0,orders:state.orders.map(r=>({index:r.index,orderId:r.order.id,items:r.order.items,thbMinor:r.order.thbMinor,usdgMinor:r.order.usdgMinor,receipt:r.receipt}))},null,2)+'\n');
