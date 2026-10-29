import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceFoodBatch, foodBatchComplete, type FoodBatch } from '../packages/domain/src/food-batch-lifecycle';

const start = ():FoodBatch => ({driverId:'driver',version:1,legs:[{shipmentId:'a',state:'ACCEPTED',pickedUp:false},{shipmentId:'b',state:'ACCEPTED',pickedUp:false}]});
test('each shipment has independent custody and the driver stays occupied until all close',()=>{
 let batch=start();batch=advanceFoodBatch(batch,'a',1,'ARRIVE_PICKUP');batch=advanceFoodBatch(batch,'a',2,'CONFIRM_PICKUP');
 assert.throws(()=>advanceFoodBatch(batch,'a',3,'RELEASE'),/CUSTODY_RETAINED/);
 batch=advanceFoodBatch(batch,'b',3,'RELEASE');assert.equal(foodBatchComplete(batch),false);
 batch=advanceFoodBatch(batch,'a',4,'ARRIVE_DROPOFF');batch=advanceFoodBatch(batch,'a',5,'CONFIRM_DELIVERY');
 assert.equal(foodBatchComplete(batch),true);assert.throws(()=>advanceFoodBatch(batch,'a',6,'INCIDENT'),/TRANSITION_INVALID/);
});
test('incident recovery preserves custody; stale, invalid and duplicate requests fail',()=>{
 let batch=start();assert.throws(()=>advanceFoodBatch(batch,'a',0,'ARRIVE_PICKUP'),/VERSION_CONFLICT/);
 assert.throws(()=>advanceFoodBatch(batch,'missing',1,'RELEASE'),/RESOURCE_NOT_FOUND/);
 batch=advanceFoodBatch(batch,'a',1,'ARRIVE_PICKUP');batch=advanceFoodBatch(batch,'a',2,'CONFIRM_PICKUP');
 batch=advanceFoodBatch(batch,'a',3,'INCIDENT');batch=advanceFoodBatch(batch,'a',4,'RESUME');
 assert.equal(batch.legs[0].state,'PICKED_UP');assert.throws(()=>advanceFoodBatch(batch,'a',5,'RELEASE'),/CUSTODY_RETAINED/);
 assert.throws(()=>foodBatchComplete({...batch,legs:[batch.legs[0],batch.legs[0]]}),/INVALID_BATCH/);
});
