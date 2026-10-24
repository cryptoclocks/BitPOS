import {createServer} from 'node:http';
import assert from'node:assert/strict';import{randomUUID,createHash}from'node:crypto';import{readFile,writeFile}from'node:fs/promises';import type pg from'pg';
type Call=(path:string,method?:string,body?:unknown,token?:string,status?:number)=>Promise<any>;
export async function verifyPickupCurrent({db,call,merchant,branch,product,customerToken,merchantToken,otherMerchantToken,settle}:{db:pg.Client;call:Call;merchant:string;branch:string;product:string;customerToken:string;merchantToken:string;otherMerchantToken:string;settle:(order:string)=>Promise<void>}){
 const line={lineId:randomUUID(),productId:product,qty:1,optionVersion:null,selections:[],allergyNote:null};
 const quote=await call('/api/mobile/v1/food/quotes','POST',{branchId:branch,serving:'pickup',items:[line]},customerToken);assert.equal(quote.total.amountMinor,'270');assert.equal(quote.delivery,null);
 await call('/api/mobile/v1/food/quotes','POST',{branchId:branch,serving:'pickup',items:[line],total:{amountMinor:'1'}},customerToken,422);
 const command={branchId:branch,quoteId:quote.id,priceVersion:quote.priceVersion,idempotencyKey:randomUUID()};
 // Actual upstream commits; this owned loopback proxy deliberately drops only
 // the downstream response. Exact replay must recover the original order.
 const upstream=new URL(process.env.BITPOS_DISPATCH_FIXTURE_BASE??'');
 assert.equal(upstream.hostname,'127.0.0.1');assert.equal(upstream.port,'3046');
 let committedId:string|undefined,proxyError:unknown;
 const proxy=createServer(async(req,res)=>{try{
  assert.equal(req.method,'POST');assert.equal(req.url,'/orders');
  let body='';for await(const part of req)body+=part;
  const response=await fetch(upstream.origin+'/api/mobile/v1/food/orders',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+customerToken},body});
  assert.equal(response.status,200);const result=await response.json();committedId=result.order.id;res.destroy();
 }catch(error){proxyError=error;res.destroy();}});
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 try{const address=proxy.address();assert.ok(address&&typeof address!=='string');await assert.rejects(fetch('http://127.0.0.1:'+address.port+'/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(10000)}));if(proxyError)throw proxyError;assert.ok(committedId);}finally{await new Promise<void>((resolve,reject)=>proxy.close(error=>error?reject(error):resolve()));}
 const results=await Promise.all(Array.from({length:8},()=>call('/api/mobile/v1/food/orders','POST',command,customerToken)));const id:string=results[0].order.id;assert.equal(id,committedId);assert.ok(results.every(r=>r.order.id===id));
 await call('/api/orders/'+id,'GET',undefined,otherMerchantToken,404);
 const prepare={status:'PREPARING',expectedVersion:0,idempotencyKey:randomUUID()};
 await call('/api/orders/'+id+'/fulfillment','POST',prepare,merchantToken,409);
 const acceptance={status:'ACCEPTED',expectedVersion:0,idempotencyKey:randomUUID(),preparationMinutes:23};
 const accepted=await Promise.all(Array.from({length:4},()=>call('/api/orders/'+id+'/acceptance','POST',acceptance,merchantToken)));assert.ok(accepted.every(r=>JSON.stringify(r)===JSON.stringify(accepted[0])));
 await call('/api/orders/'+id+'/fulfillment','POST',prepare,merchantToken,409);
 await settle(id);await settle(id); // Same finalized fixture attempt must not duplicate effects.
 for(const [version,status]of ['PREPARING','READY','COLLECTED'].entries()){
  const cmd={status,expectedVersion:version,idempotencyKey:randomUUID()};
  const receipts:unknown[]=await Promise.all([call('/api/orders/'+id+'/fulfillment','POST',cmd,merchantToken),call('/api/orders/'+id+'/fulfillment','POST',cmd,merchantToken)]);assert.deepEqual(receipts[0],receipts[1]);
 }
 const order=await call('/api/mobile/v1/food/orders/'+id,'GET',undefined,customerToken);assert.equal(order.status,'PAID');assert.equal(order.fulfillmentStatus,'COLLECTED');
 const persisted=(await db.query(`SELECT o.status,f.status kitchen,(SELECT count(*)::int FROM bitpos.payments p WHERE p.order_id=o.id) payments,(SELECT count(*)::int FROM bitpos.food_shipments s WHERE s.order_id=o.id) shipments,(SELECT count(*)::int FROM bitpos.pickup_notifications n WHERE n.order_id=o.id) mini_notices,(SELECT stock FROM bitpos.products WHERE id=$2) stock FROM bitpos.orders o JOIN bitpos.order_fulfillment f ON(f.merchant_id,f.order_id)=(o.merchant_id,o.id)WHERE o.id=$1`,[id,product])).rows[0];
 assert.deepEqual(persisted,{status:'PAID',kitchen:'COLLECTED',payments:1,shipments:0,mini_notices:0,stock:4});
 const raceQuotes=await Promise.all([1,2].map(()=>call('/api/mobile/v1/food/quotes','POST',{branchId:branch,serving:'pickup',items:[{...line,lineId:randomUUID(),qty:4}]},customerToken)));
 const race=await Promise.all(raceQuotes.map(q=>call('/api/mobile/v1/food/orders','POST',{branchId:branch,quoteId:q.id,priceVersion:q.priceVersion,idempotencyKey:randomUUID()},customerToken).then(value=>({ok:true,value})).catch(error=>({ok:false,error}))));
 assert.equal(race.filter(r=>r.ok).length,1);
 const loser=race.find(r=>!r.ok)as {error:unknown};assert.equal((loser.error as {actual?:number}).actual,409);
 const winner=(race.find(r=>r.ok)as {ok:boolean;value:any}).value.order.id;
 await call('/api/orders/'+winner+'/acceptance','POST',{status:'REJECTED',reason:'Synthetic stock race cleanup',expectedVersion:0,idempotencyKey:randomUUID()},merchantToken);
 const released=(await db.query('SELECT status,reservation_released FROM bitpos.orders WHERE id=$1',[winner])).rows[0];assert.deepEqual(released,{status:'EXPIRED',reservation_released:true});
 assert.equal((await db.query('SELECT stock FROM bitpos.products WHERE id=$1',[product])).rows[0].stock,4);
 const sources=['apps/api/src/mobile-food.ts','apps/api/src/orders.ts','apps/api/src/fulfillment.ts'];
 const receipt={status:'PASS_CURRENT_PICKUP_HTTP_SQL',checkedAtUtc:new Date().toISOString(),orderId:id,persisted,checks:['canonical270 pickup with no delivery snapshot','extra client-total field rejected','two concurrent orders contend last4 available units→1winner; merchant rejection closes unpaid winner and releases stock reservation','Actual committed upstream response deliberately lost;8exact retries recover same original order','foreignmerchant404','unpaid kitchen refused before and after acceptance','4same acceptance commands→one receipt','same finalized fixture settlement replay→onepayment/stock effect','each kitchen transition concurrent exact replay','customer reads final PAID/COLLECTED; no shipment or Mini notice'],sourceSha256:Object.fromEntries(await Promise.all(sources.map(async p=>[p,createHash('sha256').update(await readFile(p)).digest('hex')]))),limits:['HTTP/SQL only, no current native/browser full journey','Synthetic SQL settlement seam, not external provider/chain payment']};
 const runStamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
 await writeFile('.omp/work/flutter-delivery-20261016/evidence/pickup-current-http-sql-'+runStamp+'.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(receipt));
}
