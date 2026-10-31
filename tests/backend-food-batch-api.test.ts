import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
import {FoodBatchCandidatesSchema,FoodBatchDraftReceiptSchema} from '../packages/contracts/src/food-batch-candidates';

const integration={skip:process.env.BITPOS_BACKEND_INTEGRATION!=='1'||process.env.BITPOS_OWN_FOOD_FIXTURE!=='1'};
test('batch snapshot and draft enforce scope and exact replay over HTTP',integration,async()=>{
 const {server}=await import('../apps/api/src/index');const {pool}=await import('../apps/api/src/db');
 const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const fixture=(await db.query(`SELECT m.id merchant,b.id branch,s.id shipment,g.account_id staff FROM bitpos.merchants m
 JOIN bitpos.marketplace_branches b ON b.merchant_id=m.id JOIN bitpos.food_shipments s ON s.merchant_id=m.id
 JOIN bitpos.platform_role_scopes sc ON sc.merchant_id=m.id JOIN bitpos.platform_staff_role_grants g ON g.id=sc.grant_id
 WHERE m.name='DELIVERY060 ROLLBACK FIXTURE' AND g.role='dispatcher' AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()
 ORDER BY s.created_at DESC LIMIT 1`)).rows[0];
 assert.ok(fixture,'run the disposable joined race fixture first');
 const token=randomBytes(32).toString('base64url'),session=randomUUID();
 const draftFixture=(await db.query(`SELECT c.actor_account_id,c.request,c.response FROM bitpos.food_batch_draft_commands c
 JOIN bitpos.merchants m ON m.id=(c.request->>0)::uuid WHERE m.name='DELIVERY060 ROLLBACK FIXTURE'
 AND NOT EXISTS(SELECT 1 FROM bitpos.platform_staff_role_grants g WHERE g.account_id=c.actor_account_id AND g.role='dispatcher' AND g.revoked_at IS NULL)
 ORDER BY c.created_at DESC LIMIT 1`)).rows[0];
 assert.ok(draftFixture,'run the disposable draft race fixture first');
 const draftGrant=randomUUID(),draftSession=randomUUID(),draftToken=randomBytes(32).toString('base64url');
 const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes',now()+interval '10 minutes')",[session,fixture.staff,randomUUID(),hash(token),hash(randomBytes(32).toString('hex'))]);
 await db.query("INSERT INTO bitpos.platform_staff_role_grants(id,account_id,role,granted_by,expires_at) VALUES($1,$2,'dispatcher','Synthetic HTTP test',now()+interval '10 minutes')",[draftGrant,draftFixture.actor_account_id]);
 await db.query('INSERT INTO bitpos.platform_role_scopes(grant_id,merchant_id) VALUES($1,$2)',[draftGrant,draftFixture.request[0]]);
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes',now()+interval '10 minutes')",[draftSession,draftFixture.actor_account_id,randomUUID(),hash(draftToken),hash(randomBytes(32).toString('hex'))]);
 // Refresh only the synthetic fixture's finite driver eligibility for this local HTTP run.
 await db.query("UPDATE bitpos.driver_availability SET requested_online=true,heartbeat_expires_at=clock_timestamp()+interval '10 minutes' WHERE driver_id=$1",[draftFixture.request[2].driverId]);
 const grantUpdate=await db.query("UPDATE bitpos.driver_food_service_grants SET issued_grant_id=$1,valid_until=clock_timestamp()+interval '10 minutes',revision=revision+1 WHERE driver_id=$2 AND merchant_id=$3 AND branch_id=$4",[draftGrant,draftFixture.request[2].driverId,draftFixture.request[0],draftFixture.request[1]]);
 assert.equal(grantUpdate.rowCount,1);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const addr=server.address();if(!addr||typeof addr==='string')throw Error('No local server address');
 const url=`http://127.0.0.1:${addr.port}/api/mobile/v1/platform/merchants/${fixture.merchant}/branches/${fixture.branch}/food-batch-candidates/${fixture.shipment}`;
 try{
  const noAuth=await fetch(url);assert.equal(noAuth.status,401);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token}});assert.equal(response.status,200);
  const value=FoodBatchCandidatesSchema.parse(await response.json());assert.equal(value.assignmentCreated,false);
  assert.ok(value.items.every(item=>Object.keys(item).sort().join(',')==='generation,shipmentId,version'));
  const outside=url.replace(fixture.merchant,randomUUID());
  assert.equal((await fetch(outside,{headers:{Authorization:'Bearer '+token}})).status,403,'staff scope does not extend to another merchant');
  assert.equal((await fetch(url+'?extra=1',{headers:{Authorization:'Bearer '+token}})).status,422);
  assert.equal((await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token}})).status,405);
  const draftUrl=`http://127.0.0.1:${addr.port}/api/mobile/v1/platform/merchants/${draftFixture.request[0]}/branches/${draftFixture.request[1]}/food-batch-drafts`;
  const send=(body:unknown)=>fetch(draftUrl,{method:'POST',headers:{Authorization:'Bearer '+draftToken,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await fetch(draftUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(draftFixture.request[2])})).status,401);
  assert.equal((await fetch(draftUrl.replace(draftFixture.request[0],randomUUID()),{method:'POST',headers:{Authorization:'Bearer '+draftToken,'Content-Type':'application/json'},body:JSON.stringify(draftFixture.request[2])})).status,403);
  const replay=await send(draftFixture.request[2]);assert.equal(replay.status,200);
  assert.deepEqual(FoodBatchDraftReceiptSchema.parse(await replay.json()),FoodBatchDraftReceiptSchema.parse(draftFixture.response));
  const fresh={...draftFixture.request[2],idempotencyKey:randomUUID()};
  const created=await send(fresh);assert.equal(created.status,200);const createdReceipt=FoodBatchDraftReceiptSchema.parse(await created.json());assert.notEqual(createdReceipt.batchId,draftFixture.response.batchId);
  const repeated=await send(fresh);assert.equal(repeated.status,200);assert.deepEqual(FoodBatchDraftReceiptSchema.parse(await repeated.json()),createdReceipt);
  const changed=await send({...draftFixture.request[2],items:draftFixture.request[2].items.slice(0,2)});assert.equal(changed.status,409);assert.equal((await changed.json() as any).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await send({...draftFixture.request[2],items:[]})).status,422);
  await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[session]);
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+token}})).status,401);
 }finally{await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=ANY($1::uuid[])',[[session,draftSession]]);await db.query('UPDATE bitpos.platform_staff_role_grants SET revoked_at=clock_timestamp() WHERE id=$1',[draftGrant]);await db.query("UPDATE bitpos.driver_availability SET requested_online=false,heartbeat_expires_at=clock_timestamp() WHERE driver_id=$1",[draftFixture.request[2].driverId]);await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await pool.end();await db.end();}
});
