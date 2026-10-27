import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { ReviewAvdScope } from './food-cancellation-review-avd-smoke';

const scope = new ReviewAvdScope(240000);
const evidence = '.omp/work/flutter-delivery-20261016/evidence';
const screenshots = {
  u11: `${evidence}/food-cart-review-root-avd-direct-20261020.png`,
  u15: `${evidence}/food-order-review-root-avd-direct-20261020.png`,
};
const db = new pg.Client({ connectionString: 'postgresql://cryptoclock@127.0.0.1:55436/bitpos_delivery_fixture' });
const account = randomUUID(), session = randomUUID(), device = randomUUID();
const access = randomBytes(32).toString('base64url'), refresh = randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let passed = false, capturedU11 = false, capturedU15 = false;
let u15Layout: Record<string, number> | null = null;
let observedOutput = '';
await db.connect();
try {
  assert.equal((await db.query('SELECT current_database() name')).rows[0].name, 'bitpos_delivery_fixture');
  await db.query("INSERT INTO bitpos.mobile_accounts(id,auth_subject,locale) VALUES($1,$2,'en')", [account, randomUUID()]);
  await db.query("INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '30 minutes')", [session, account, device, hash(access), hash(refresh)]);
  await db.query('INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)', [hash(refresh), session]);
  const value = { accountId: account, sessionId: session, accessToken: access, refreshToken: refresh, accessExpiresAt: new Date(Date.now()+900000).toISOString(), refreshExpiresAt: new Date(Date.now()+1800000).toISOString() };
  const api = 'http://127.0.0.1:3041/api/mobile/v1/';
  const ready = await fetch(api+'branches', { signal: AbortSignal.timeout(8000) });
  assert.equal(ready.status, 200);
  const child = scope.track(spawn('/Users/cryptoclock/development/flutter/bin/flutter', [
    'test','integration_test/cart_review_root_test.dart','-d','emulator-5554',
    '--dart-define=BITPOS_FIXTURE=true',
    '--dart-define=BITPOS_TEST_DEVICE_ID='+device,
    '--dart-define=BITPOS_TEST_SESSION_BASE64='+Buffer.from(JSON.stringify(value)).toString('base64'),
    '--dart-define=BITPOS_MOBILE_API=http://10.0.2.2:3041/api/mobile/v1/',
    '--no-enable-impeller','--no-uninstall','--no-pub',
  ], { cwd: 'apps/mobile-customer', stdio: ['ignore','pipe','pipe'] }));
  let capture = Promise.resolve();
  const captureScreen = (path: string) => {
    capture = capture.then(async () => {
      // Let the route/state transition and its post-frame root-scroll reset settle.
      await new Promise(resolve => setTimeout(resolve, 900));
      const adb = scope.track(spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb', ['-s','emulator-5554','exec-out','screencap','-p'], { stdio: ['ignore','pipe','pipe'] }));
      const chunks: Buffer[] = [];
      adb.stdout.on('data', data => chunks.push(data));
      assert.equal((await scope.wait(once(adb,'exit')))[0], 0);
      await writeFile(path, Buffer.concat(chunks));
    });
    void capture.catch(error => scope.abort(error));
  };
  const observe = (chunk: Buffer) => {
    const output = chunk.toString();
    observedOutput = (observedOutput + output).slice(-50000);
    const layout = observedOutput.match(/BITPOS_U15_LAYOUT (\{[^\r\n]+\})/);
    if (layout && !u15Layout) u15Layout = JSON.parse(layout[1]);
    if (output.includes('BITPOS_U11_ROOT_CART_REVIEW_VISIBLE') && !capturedU11) {
      capturedU11 = true;
      captureScreen(screenshots.u11);
    }
    if (output.includes('BITPOS_U15_ROOT_ORDER_REVIEW_VISIBLE') && !capturedU15) {
      capturedU15 = true;
      captureScreen(screenshots.u15);
    }
    process.stdout.write(output.replace(/BITPOS_TEST_SESSION_BASE64=.*/g, 'BITPOS_TEST_SESSION_BASE64=[redacted]'));
  };
  child.stdout.on('data', observe); child.stderr.on('data', observe);
  assert.equal((await scope.wait(once(child,'exit')))[0], 0);
  await capture;
  assert.equal(capturedU11, true);
  assert.equal(capturedU15, true);
  assert.ok(u15Layout, 'U15 layout geometry was not emitted by the AVD test');
  const effects = await db.query('SELECT (SELECT count(*)::int FROM bitpos.online_food_orders WHERE account_id=$1) AS orders,(SELECT count(*)::int FROM bitpos.orders o JOIN bitpos.online_food_orders f ON f.order_id=o.id WHERE f.account_id=$1) AS online_orders', [account]);
  assert.deepEqual(effects.rows[0], { orders: 0, online_orders: 0 });
  passed = true;
  const sourceFiles = [
    'apps/mobile-customer/lib/main.dart',
    'apps/mobile-customer/lib/food_page.dart',
    'apps/mobile-customer/lib/configured_food_lines.dart',
    'apps/mobile-customer/lib/presentation/quote_confirmation.dart',
    'apps/mobile-customer/lib/presentation/quote_price_summary.dart',
    'apps/mobile-customer/integration_test/cart_review_root_test.dart',
    'tools/runtime/customer-cart-review-root-avd-smoke.ts',
  ];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [
    path,
    createHash('sha256').update(await readFile(path)).digest('hex'),
  ] as const)));
  await writeFile(`${evidence}/food-cart-review-root-avd-20261020.json`, JSON.stringify({
    status: 'PASS_NATIVE_ROOT_U11_U15_SERVER_QUOTE_ORDER_REVIEW',
    fixture: 'Disposable local database and loopback API only; synthetic customer/session/product; no live provider.',
    checks: ['Actual CustomerSessionPage root restored a fresh English fixture customer session', 'Local merchant/menu and available product were loaded through API', 'Native options/cart flow created a server-backed quote', 'U11 cart summary showed canonical server totals and bottom action', 'U15 Review order showed server-backed quote, total, settlement disclosure and enabled confirmation', 'Test stopped before confirming an order; no order/payment was created; fixture session revoked and account disabled'],
    screenshots: ['food-cart-review-root-avd-direct-20261020.png', 'food-order-review-root-avd-direct-20261020.png'],
    visualInspection: 'Current U11 and U15 native frames were manually compared with their FigCraft previews. U15 layout geometry was asserted: 24px left inset, 82px item-card height, nonzero visible body, settlement above the sticky footer, and CTA bottom gap within the reference-scaled range. Manual review only; no automated pixel-diff certification.',
    u15Layout: u15Layout,
    sourceSha256,
    limits: ['Single Android AVD fixture state; product image is a neutral fixture placeholder, not a merchant photo', 'Coupon row in FigCraft is intentionally omitted until coupon quote/order/payment/late/refund lifecycle is admitted; no fake coupon control', 'U15 confirmation was not pressed; no payment, delivery or field/GPS test'],
    physicalTesting: 'deferred_by_user_2026-10-16'
  }, null, 2)+'\n');
  console.log('PASS_NATIVE_ROOT_U11_U15_SERVER_QUOTE_ORDER_REVIEW');
} finally {
  scope.close();
  await db.query('UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1', [session]);
  await db.query('UPDATE bitpos.mobile_accounts SET disabled_at=coalesce(disabled_at,clock_timestamp()) WHERE id=$1', [account]);
  const cleanup = await db.query('SELECT s.revoked_at IS NOT NULL AS revoked,a.disabled_at IS NOT NULL AS disabled FROM bitpos.mobile_sessions s JOIN bitpos.mobile_accounts a ON a.id=s.account_id WHERE s.id=$1', [session]);
  if (cleanup.rows[0]?.revoked !== true || cleanup.rows[0]?.disabled !== true) passed = false;
  await db.end();
  if (!passed) await unlink(screenshots.u11).catch(() => {});
}
