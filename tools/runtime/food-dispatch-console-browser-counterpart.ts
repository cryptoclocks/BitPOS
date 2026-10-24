import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import pg from 'pg';
const root='.omp/work/flutter-delivery-20261016/evidence/';
const fixture=JSON.parse(await readFile(root+'dispatch085-console-browser-fixture-20261019.json','utf8'));
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'});
await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() AS n')).rows[0].n,'bitpos_delivery_fixture');
 const head=(await db.query(`SELECT h.revision::text,v.id,v.enabled,v.vehicle_type,v.reason,v.issued_by
  FROM bitpos.food_dispatch_policy_heads h JOIN bitpos.food_dispatch_policy_versions v ON v.id=h.version_id
  WHERE h.merchant_id=$1 AND h.branch_id=$2`,[fixture.merchant,fixture.branch])).rows[0];
 assert.equal(head.revision,'1');assert.equal(head.enabled,true);assert.equal(head.issued_by,fixture.accountId);
 assert.match(head.reason,/Local synthetic085 policy publication/);
 const policy=(await db.query(`SELECT request,response FROM bitpos.food_dispatch_policy_commands
  WHERE actor_account_id=$1 AND request->>0=$2 AND request->>1=$3`,[fixture.accountId,fixture.merchant,fixture.branch])).rows;
 assert.equal(policy.length,1);assert.equal(policy[0].response.policyId,head.id);
 assert.equal(policy[0].response.revision,head.revision);assert.equal(policy[0].request[2].expectedVersion,'0');
 assert.equal(policy[0].request[2].reason,head.reason);
 const search=(await db.query(`SELECT version::text,epoch::text,mode,attention_reason,cycle_number,offers_remaining
  FROM bitpos.food_dispatch_searches WHERE shipment_id=$1`,[fixture.shipmentId])).rows[0];
 assert.equal(search.version,'2');assert.equal(search.mode,'MANUAL');assert.equal(search.attention_reason,'MANUAL');assert.equal(search.cycle_number,1);
 const commands=(await db.query(`SELECT request,response FROM bitpos.food_dispatch_search_commands
  WHERE actor_account_id=$1 AND response->>'shipmentId'=$2 ORDER BY created_at`,[fixture.accountId,fixture.shipmentId])).rows;
 assert.equal(commands.length,2);assert.deepEqual(commands.map(row=>row.response.mode),['AUTO','MANUAL']);
 assert.deepEqual(commands.map(row=>row.response.version),['1','2']);
 const assignmentCount=(await db.query('SELECT count(*)::int AS n FROM bitpos.food_assignments WHERE shipment_id=$1',[fixture.shipmentId])).rows[0].n;
 assert.equal(assignmentCount,0);
 const receipt={status:'PASS_ACTUAL_COMPILED_BROWSER_TO_PERSISTED_COUNTERPART',fixture:fixture.shipmentId,accountId:fixture.accountId,
  policy:head,search,searchCommandModes:commands.map(row=>row.response.mode),searchCommandVersions:commands.map(row=>row.response.version),
  assignmentCount,observedPolicyCommandRows:policy.length,
  browser:'Actual local synthetic OTP login, scoped merchant/branch snapshot, enable policy publication, START then MANUAL through current web4384 proxy to API3017; no network mocks',
  limits:['No automatic worker outcome or real provider success inferred','Offer/recovery, auth/paging and exact fidelity runtime acceptance remain pending'],
  physicalTesting:'deferred_by_user_2026-10-16'};
 await writeFile(root+'dispatch085-console-browser-counterpart-20261019.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt));
}finally{await db.end();}
