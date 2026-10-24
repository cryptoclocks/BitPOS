import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { ReviewAvdScope } from './food-cancellation-review-avd-smoke';

const scope = new ReviewAvdScope(240000);
const evidence = '.omp/work/flutter-delivery-20261016/evidence';
const screenshots = new Map([
  ['BITPOS_U12_ROOT_ADDRESS_PICKER_VISIBLE', `${evidence}/customer-u12-address-picker-root-avd-20261020.png`],
  ['BITPOS_U13_EDIT_ADDRESS_VISIBLE', `${evidence}/customer-u13-address-edit-root-avd-20261020.png`],
  ['BITPOS_U14_ADDRESS_PIN_UNAVAILABLE_VISIBLE', `${evidence}/customer-u14-address-pin-unavailable-root-avd-20261020.png`],
]);
const db = new pg.Client({ connectionString: 'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture' });
const account = randomUUID(), session = randomUUID(), device = randomUUID();
const homeAddress = account.slice(0, 24)+'000000000001', officeAddress = account.slice(0, 24)+'000000000002';
const access = randomBytes(32).toString('base64url'), refresh = randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let passed = false;
const captured = new Set<string>();
await db.connect();
try {
  assert.equal((await db.query('SELECT current_database() name')).rows[0].name, 'bitpos_delivery_fixture');
  await db.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,locale) VALUES($1,$2,'en')", [account, randomUUID()]);
  await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '30 minutes')", [session, account, device, hash(access), hash(refresh)]);
  await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)', [hash(refresh), session]);
  await db.query("INSERT INTO bitpos.mobile_addresses(id,account_id,label,recipient_name,phone,address_text,instructions,latitude_e7,longitude_e7) VALUES ($2,$1,'Home','Fixture Customer','+66812345678','Sukhumvit 49 · Khlong Tan Nuea','',137500000,1005000000),($3,$1,'Office','Fixture Customer','+66812345678','Sample building · Floor 5','',137600000,1005200000)", [account, homeAddress, officeAddress]);
  const value = { accountId: account, sessionId: session, accessToken: access, refreshToken: refresh, accessExpiresAt: new Date(Date.now()+900000).toISOString(), refreshExpiresAt: new Date(Date.now()+1800000).toISOString() };
  const api = 'http://127.0.0.1:3041/api/mobile/v1/';
  const ready = await fetch(api+'branches', { signal: AbortSignal.timeout(8000) });
  assert.equal(ready.status, 200);
  const child = scope.track(spawn('/Users/cryptoclock/development/flutter/bin/flutter', [
    'test','integration_test/delivery_address_picker_root_test.dart','-d','emulator-5554',
    '--dart-define=BITPOS_FIXTURE=true',
    '--dart-define=BITPOS_TEST_DEVICE_ID='+device,
    '--dart-define=BITPOS_TEST_SESSION_BASE64='+Buffer.from(JSON.stringify(value)).toString('base64'),
    '--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:3041/api/mobile/v1/',
    '--no-enable-impeller','--no-uninstall','--no-pub',
  ], { cwd: 'apps/mobile-customer', stdio: ['ignore','pipe','pipe'] }));
  let capture = Promise.resolve();
  const observe = (chunk: Buffer) => {
    const output = chunk.toString();
    for (const [marker, screenshot] of screenshots) if (output.includes(marker) && !captured.has(marker)) {
      captured.add(marker);
      capture = capture.then(async () => {
        const adb = scope.track(spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb', ['-s','emulator-5554','exec-out','screencap','-p'], { stdio: ['ignore','pipe','pipe'] }));
        const chunks: Buffer[] = [];
        adb.stdout.on('data', data => chunks.push(data));
        assert.equal((await scope.wait(once(adb,'exit')))[0], 0);
        await writeFile(screenshot, Buffer.concat(chunks));
      });
      void capture.catch(error => scope.abort(error));
    }
    process.stdout.write(output.replace(/BITPOS_TEST_SESSION_BASE64=.*/g, 'BITPOS_TEST_SESSION_BASE64=[redacted]'));
  };
  child.stdout.on('data', observe); child.stderr.on('data', observe);
  assert.equal((await scope.wait(once(child,'exit')))[0], 0);
  await capture;
  assert.deepEqual([...captured].sort(), [...screenshots.keys()].sort());
  const effects = await db.query('SELECT (SELECT count(*)::int FROM bitpos.online_food_orders WHERE account_id=$1) AS orders,(SELECT count(*)::int FROM bitpos.payments p JOIN bitpos.orders o ON o.id=p.order_id JOIN bitpos.online_food_orders f ON f.order_id=o.id WHERE f.account_id=$1) AS payments,(SELECT count(*)::int FROM bitpos.mobile_addresses WHERE account_id=$1) AS addresses,(SELECT count(*)::int FROM bitpos.mobile_addresses WHERE account_id=$1 AND NOT archived) AS active_addresses', [account]);
  assert.deepEqual(effects.rows[0], { orders: 0, payments: 0, addresses: 3, active_addresses: 2 });
  const savedPin = await db.query('SELECT recipient_name,phone,instructions,latitude_e7,longitude_e7 FROM bitpos.mobile_addresses WHERE account_id=$1 AND label=$2 AND NOT archived', [account, 'Fresh edited']);
  assert.deepEqual(savedPin.rows[0], {recipient_name:'Fixture Customer',phone:'+66812345678',instructions:'Blue gate',latitude_e7:137500000,longitude_e7:1005000000});
  passed = true;
  await writeFile(`${evidence}/customer-u12-address-picker-root-avd-20261020.json`, JSON.stringify({
    status: 'PASS_NATIVE_CUSTOMER_U12_U13_ADDRESS_FLOW',
    fixture: 'Disposable local database and loopback API only; synthetic account and session; no live provider.',
    checks: ['Actual CustomerSessionPage root loaded an API-backed delivery-enabled merchant', 'Selecting Delivery loaded branch service policy and account-owned address results', 'U12 opened as a dedicated native route and rendered two in-area fixture addresses in stable order', 'Selected Home returned to the order menu and reopened U12', 'U12 Add-address opened Account→My addresses; a new address was created through the authenticated local API', 'U14 rendered an explicit unavailable-map state, accepted manual coordinates, and returned them to U13 before saving', 'U13 edited the saved label and reloaded it; Office was archived through its saved-address control and disappeared from refreshed U12 results', 'SQL confirmed saved contact/instructions and exact coordinates; 3 scoped addresses, 2 active, 0 orders, 0 payments'],
    screenshots: ['customer-u12-address-picker-root-avd-20261020.png','customer-u13-address-edit-root-avd-20261020.png','customer-u14-address-pin-unavailable-root-avd-20261020.png'],
    visualInspection: 'U12 and U13 native frames manually inspected against their SVGs and spacing adjusted (U13 principal vertical geometry within about 1 logical pixel); U14 captured as explicitly unavailable-map state. English native text differs from Thai SVG; no automated pixel-diff certification.',
    limits: ['U13 edit/archive acceptance covers the Android AVD route on disposable local fixtures; no production account mutation', 'U14 uses manual coordinates because no customer-safe map tile provider is configured; no external tile provider was called', 'No physical GPS test and no order/payment or delivery transaction'],
    physicalTesting: 'deferred_by_user_2026-10-16'
  }, null, 2)+'\n');
  console.log('PASS_NATIVE_CUSTOMER_U12_U13_ADDRESS_FLOW');
} finally {
  scope.close();
  await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1', [session]);
  await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=coalesce(disabled_at,clock_timestamp()) WHERE id=$1', [account]);
  const cleanup = await db.query('SELECT s.revoked_at IS NOT NULL AS revoked,a.disabled_at IS NOT NULL AS disabled FROM bitpos.mobile_sessions s JOIN bitpos.mobile_accounts a ON a.id=s.account_id WHERE s.id=$1', [session]);
  if (cleanup.rows[0]?.revoked !== true || cleanup.rows[0]?.disabled !== true) passed = false;
  await db.end();
}
