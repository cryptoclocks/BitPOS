// Reuses the real root U11/U15 scenario and bounded AVD ownership helper.
// Only the admitted disposable W01 stack; never confirms an order or payment.
import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {copyFile, mkdtemp, readFile, readdir, rm, rmdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {ReviewAvdScope} from './food-cancellation-review-avd-smoke';

const scope = new ReviewAvdScope(300000);
const evidence = '.omp/work/h2-merchant-pricing-20261026/DS05/evidence/native-current-cart-capture2/';
const scratch = await mkdtemp(join(tmpdir(), 'bitpos-u11-batch2-'));
const created: string[] = [], retained: string[] = [];
const db = new pg.Client({connectionString: 'postgresql://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture'});
const account = randomUUID(), session = randomUUID(), device = randomUUID();
const access = randomBytes(32).toString('base64url'), refresh = randomBytes(32).toString('base64url');
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const captured = new Set<string>();
const receipt: Record<string, unknown> = {
  status: 'RUNNING', fixture: true,
  physical_testing: 'deferred_by_user_2026-10-16',
  limits: ['Actual root CustomerSessionPage with local HTTP/SQL and emulated Android',
    'No order confirmation, payment/provider operation or physical GPS proof',
    'Screenshots require parent inspection; runtime PASS is not pixel-fidelity approval'],
};
let connected = false, seeded = false, failure: unknown;
let captures = Promise.resolve();
try {
  await db.connect(); connected = true;
  assert.equal((await db.query('SELECT current_database() name')).rows[0].name, 'bitpos_w01_fixture');
  assert.equal((await fetch('http://127.0.0.1:3046/api/mobile/v1/branches', {signal: AbortSignal.timeout(8000)})).status, 200);
  await db.query('INSERT INTO bitpos.mobile_accounts(id,auth_subject,locale) VALUES($1,$2,\'en\')', [account, randomUUID()]);
  seeded = true;
  await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '30 minutes')", [session, account, device, hash(access), hash(refresh)]);
  await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)', [hash(refresh), session]);
  const sessionValue = Buffer.from(JSON.stringify({accountId:account,sessionId:session,accessToken:access,refreshToken:refresh,accessExpiresAt:new Date(Date.now()+900000).toISOString(),refreshExpiresAt:new Date(Date.now()+1800000).toISOString()})).toString('base64');
  const child = scope.track(spawn('/Users/cryptoclock/development/flutter/bin/flutter', [
    'test', 'integration_test/cart_review_root_test.dart', '-d', 'emulator-5554',
    '--dart-define=BITPOS_FIXTURE=true', '--dart-define=BITPOS_TEST_DEVICE_ID='+device,
    '--dart-define=BITPOS_TEST_SESSION_BASE64='+sessionValue,
    '--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:3046/api/mobile/v1/',
    '--no-enable-impeller', '--no-uninstall', '--no-pub',
  ], {cwd:'apps/mobile-customer',stdio:['ignore','pipe','pipe']}));
  let output = '';
  const observe = (chunk: Buffer) => {
    const text = chunk.toString(); output = (output+text).slice(-60000);
    for (const [id, marker] of [['u11','BITPOS_U11_ROOT_CART_REVIEW_VISIBLE'],['u15','BITPOS_U15_ROOT_ORDER_REVIEW_VISIBLE']]) {
      if (!output.includes(marker) || captured.has(id)) continue;
      captured.add(id);
      captures = captures.then(async () => {
        await new Promise(resolve=>setTimeout(resolve,900));
        const path = join(scratch,id+'.png'); created.push(path);
        const adb=scope.track(spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',['-s','emulator-5554','exec-out','screencap','-p'],{stdio:['ignore','pipe','pipe']}));
        const chunks: Buffer[]=[]; adb.stdout.on('data', data=>chunks.push(data));
        assert.equal((await scope.wait(once(adb,'exit')))[0],0);
        await writeFile(path,Buffer.concat(chunks));
      });
      void captures.catch(error=>scope.abort(error));
    }
    process.stdout.write(text.replaceAll(access,'[fixture-access-redacted]').replaceAll(refresh,'[fixture-refresh-redacted]').replaceAll(sessionValue,'[fixture-session-redacted]'));
  };
  child.stdout.on('data',observe); child.stderr.on('data',observe);
  assert.equal((await scope.wait(once(child,'exit')))[0],0);
  await captures;
  assert.deepEqual([...captured].sort(),['u11','u15']);
  const layout=output.match(/BITPOS_U15_LAYOUT (\{[^\r\n]+\})/);
  assert.ok(layout,'Actual root scenario must emit U15 geometry');
  receipt.u15Layout=JSON.parse(layout[1]);
  const counts=(await db.query('SELECT (SELECT count(*)::int FROM bitpos.online_food_orders WHERE account_id=$1) orders,(SELECT count(*)::int FROM bitpos.orders o JOIN bitpos.online_food_orders f ON f.order_id=o.id WHERE f.account_id=$1) online_orders',[account])).rows[0];
  assert.deepEqual(counts,{orders:0,online_orders:0}); receipt.persistedEffects=counts;
  for(const id of ['u11','u15']) {
    const path=evidence+'customer-cart-current-'+id+'-20261026.png';
    await copyFile(join(scratch,id+'.png'),path); retained.push(path);
  }
  const sources=['apps/mobile-customer/lib/presentation/food_cart_line_card.dart','apps/mobile-customer/lib/food_page.dart','apps/mobile-customer/integration_test/cart_review_root_test.dart','tools/runtime/ds05-current-cart-avd-smoke.ts'];
  receipt.sourceSha256=Object.fromEntries(await Promise.all(sources.map(async p=>[p,hash(await readFile(p,'utf8'))])));
  receipt.status='PASS_CURRENT_NATIVE_ROOT_U11_U15_LOCAL_SERVER_QUOTE';
} catch(error) { failure=error; receipt.status='FAIL'; receipt.error=String(error); }
finally {
  scope.close();
  try {
    await captures.catch(()=>{});
    if(connected && seeded) {
      await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1',[session]);
      await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=coalesce(disabled_at,clock_timestamp()) WHERE id=$1',[account]);
      const cleanup=(await db.query('SELECT a.disabled_at IS NOT NULL disabled,NOT EXISTS(SELECT 1 FROM bitpos.mobile_sessions s WHERE s.account_id=a.id AND s.revoked_at IS NULL) revoked FROM bitpos.mobile_accounts a WHERE a.id=$1',[account])).rows[0];
      assert.deepEqual(cleanup,{disabled:true,revoked:true}); receipt.identityCleanup=cleanup;
    }
  } catch(error) { failure??=error; receipt.status='FAIL_CLEANUP'; receipt.cleanupError=String(error); }
  finally { if(connected) await db.end(); }
  const scratchFiles=await readdir(scratch);
  for(const path of scratchFiles) await rm(join(scratch,path));
  await rmdir(scratch);
  receipt.captures={created,retained,deleted:scratchFiles.length,scratchDirectoryRemoved:true};
  await writeFile(evidence+'customer-cart-current-avd-20261026.json',JSON.stringify(receipt,null,2)+'\n');
}
if(failure) throw failure;
console.log(receipt.status);
