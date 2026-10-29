import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import pg from 'pg';
const root='.omp/work/flutter-delivery-20261016/evidence/',fixture=JSON.parse(await readFile(root+'dispatch085-console-browser-fixture-20261019.json','utf8')),replacement=JSON.parse(await readFile(root+'dispatch085-console-replacement-fixture-20261019.json','utf8'));
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const shipment=(await db.query('SELECT state,version::text,generation::text,active_assignment_id FROM bitpos.food_shipments WHERE id=$1',[fixture.shipmentId])).rows[0];
 assert.deepEqual(shipment,{state:'OFFERING',version:'8',generation:'5',active_assignment_id:null});
 const assignments=(await db.query('SELECT a.id,a.state,a.generation::text,a.picked_up_at,l.state AS lease FROM bitpos.food_assignments a JOIN bitpos.driver_assignment_leases l ON l.id=a.lease_id WHERE a.shipment_id=$1 ORDER BY a.generation',[fixture.shipmentId])).rows;
 assert.equal(assignments.length,2);assert.deepEqual(assignments.map(a=>({state:a.state,generation:a.generation,pickedUp:a.picked_up_at,lease:a.lease})),[{state:'RELEASED',generation:'1',pickedUp:null,lease:'RELEASED'},{state:'RELEASED',generation:'3',pickedUp:null,lease:'RELEASED'}]);
 const offers=(await db.query('SELECT driver_id,state,generation::text FROM bitpos.food_dispatch_offers WHERE shipment_id=$1 ORDER BY generation',[fixture.shipmentId])).rows;
 assert.deepEqual(offers,[{driver_id:fixture.driverId,state:'ACCEPTED',generation:'1'},{driver_id:fixture.driverId,state:'ACCEPTED',generation:'3'},{driver_id:replacement.driverId,state:'OFFERED',generation:'5'}]);
 const commands=(await db.query("SELECT operation,response FROM bitpos.food_dispatch_commands WHERE actor_account_id=$1 AND response->>'shipmentId'=$2 ORDER BY created_at",[fixture.accountId,fixture.shipmentId])).rows;
 assert.deepEqual(commands.map(c=>c.operation),['offer','staff-withdraw','offer','staff-reoffer']);
 const withdrawal=commands[1].response,reoffer=commands[3].response;
 assert.equal(withdrawal.assignmentId,assignments[0].id);assert.equal(withdrawal.shipmentGeneration,'2');assert.equal(withdrawal.shipmentVersion,'4');assert.equal(withdrawal.replacementOffer,null);
 assert.equal(reoffer.assignmentId,assignments[1].id);assert.equal(reoffer.shipmentGeneration,'5');assert.equal(reoffer.shipmentVersion,'8');assert.equal(reoffer.replacementOffer.generation,'5');assert.equal(reoffer.replacementOffer.version,'8');
 const physical=(await db.query(`SELECT (SELECT status FROM bitpos.order_fulfillment WHERE order_id=$1) AS kitchen,
  (SELECT count(*)::int FROM bitpos.refunds WHERE order_id=$1) AS refunds,
  (SELECT count(*)::int FROM bitpos.earning_accruals e JOIN bitpos.food_assignments a ON a.id=e.food_assignment_id WHERE a.shipment_id=$2) AS earnings,
  (SELECT count(*)::int FROM bitpos.driver_assignment_leases l JOIN bitpos.food_assignments a ON a.id=l.food_assignment_id WHERE a.shipment_id=$2 AND l.state='ACTIVE') AS active_leases`,[fixture.orderId,fixture.shipmentId])).rows[0];
 assert.deepEqual(physical,{kitchen:'READY',refunds:0,earnings:0,active_leases:0});
 const receipt={status:'PASS_ACTUAL_BROWSER_OFFER_CLAIM_WITHDRAW_REOFFER_PERSISTED_FENCES',shipment,assignments,offers,commandOperations:commands.map(c=>c.operation),withdrawal,reoffer,physical,
  checks:['Two browser-created offers accepted through actual authenticated synthetic-driver HTTP','Browser safety withdrawal closes first assignment and lease; new shipment generation2/version4','Browser VEHICLE replacement atomically releases second assignment/lease and offers distinct eligible driver generation5/version8','Canonical exact success receipt passes corrected generation journal fence and UI retires original command','Kitchen remains READY, no active lease/refunds/earnings; offer is not acceptance, delivery or payout'],
  fixture:'Finite synthetic local identities/document approval/service authority/payment verifier; actual compiled web4384 to current API3017 and persisted domain rows. No AVD claim for this slice.',physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile(root+'dispatch085-console-browser-recovery-counterpart-20261019.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{await db.end();}
