import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {runSettlement088EarningsAvd} from './settlement088-earnings-avd-smoke';
// Dedicated disposable loopback only; never read application environment/secrets.
const db=new pg.Client({connectionString:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture',connectionTimeoutMillis:3000,statement_timeout:10000});
const prior=JSON.parse(await readFile('.omp/work/flutter-delivery-20261016/evidence/settlement088-current-http-20261019.json','utf8'));
const session=randomUUID(),device=randomUUID(),access=randomBytes(32).toString('base64url');
await db.connect();
try{
 assert.equal((await db.query('SELECT current_database() n')).rows[0].n,'bitpos_delivery_fixture');
 const facts=(await db.query("SELECT d.account_id::text account,b.state batch_state,e.state,e.id::text accrual FROM bitpos.settlement088_batches b JOIN bitpos.settlement088_items i ON i.batch_id=b.id JOIN bitpos.earning_accruals e ON e.id=i.accrual_id JOIN bitpos.driver_profiles d ON d.id=b.driver_id WHERE b.id=$1 AND e.id=$2",[prior.batchId,prior.accrualId])).rows[0];
 assert.ok(facts,'Existing labelled fixture required');assert.equal(facts.batch_state,'CANCELLED');assert.equal(facts.state,'AVAILABLE');
 await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '1 hour')",[session,facts.account,device,createHash('sha256').update(access).digest('hex'),createHash('sha256').update(randomBytes(32)).digest('hex')]);
 await runSettlement088EarningsAvd({db,base:'http://127.0.0.1:3022',driverActor:{account:facts.account,session,access},accrualId:prior.accrualId,batchId:prior.batchId});
}finally{
 await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1',[session]);await db.end();
}
