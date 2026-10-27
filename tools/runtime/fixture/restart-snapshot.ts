// Persisted state comparison only; no tokens, provider callbacks or payment mutations.
import assert from'node:assert/strict';import pg from'pg';import{readFile,writeFile}from'node:fs/promises';
import{assertLocalFoodFixture}from'./assert-local';
const dir='.omp/work/flutter-delivery-20261016/evidence',out=dir+'/w02-process-restart-20261021.json';
const pickup=JSON.parse(await readFile(dir+'/pickup-current-http-sql-20261021.json','utf8'));
const delivery=JSON.parse(await readFile(dir+'/delivery-food-current-http-sql-20261021.json','utf8'));
const db=new pg.Client({host:'127.0.0.1',port:55446,database:'bitpos_w01_fixture'});await db.connect();
try{await assertLocalFoodFixture(db);
 const rows=(await db.query(`SELECT o.id,o.status,o.version,f.status kitchen,(SELECT count(*)::int FROM bitpos.payments p WHERE p.order_id=o.id) payments,o.reservation_released,(SELECT count(*)::int FROM bitpos.earning_accruals e JOIN bitpos.food_assignments a ON a.id=e.food_assignment_id JOIN bitpos.food_shipments s ON s.id=a.shipment_id WHERE s.order_id=o.id) earning_rows FROM bitpos.orders o JOIN bitpos.order_fulfillment f ON(f.merchant_id,f.order_id)=(o.merchant_id,o.id)WHERE o.id=ANY($1::uuid[])ORDER BY o.id`,[[pickup.orderId,delivery.orderId]])).rows;
 assert.equal(rows.length,2);assert.ok(rows.every(r=>r.status==='PAID'&&r.kitchen==='COLLECTED'&&r.payments===1));
 if(process.argv.includes('--before'))await writeFile(out,JSON.stringify({status:'RESTART_NOT_YET_VERIFIED',before:rows},null,2)+'\n');
 else{const prior=JSON.parse(await readFile(out,'utf8'));assert.deepEqual(rows,prior.before);await writeFile(out,JSON.stringify({...prior,status:'PASS_PERSISTED_FOOD_STATE_AFTER_API_POSTGRES_RESTART',after:rows,checkedAtUtc:new Date().toISOString(),limits:['Actual orderly API/PostgreSQL restart with committed records unchanged','No lost-response or midtransaction crash simulation; command replay separately tested','SQL-only settlement fixture; not external payment proof']},null,2)+'\n');console.log('PASS_PERSISTED_FOOD_STATE_AFTER_API_POSTGRES_RESTART');}
}finally{await db.end();}
