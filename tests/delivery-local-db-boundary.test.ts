import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

for(const suffix of ['?host=127.0.0.1&port=55439','?host=/tmp','?dbname=actual_use','#fragment']){
 test('Disposable migration rejects connection override '+suffix,()=>{
  const result=spawnSync('pnpm',['exec','tsx','tools/runtime/delivery-local-db.ts'],{
   encoding:'utf8',timeout:10000,
   env:{...process.env,BITPOS_DELIVERY_FIXTURE_DATABASE_URL:'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture'+suffix}
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,/Disposable delivery database must use a loopback URL ending in \/bitpos_delivery_fixture/);
  assert.doesNotMatch(result.stdout,/Applied disposable schema/);
 });
}
