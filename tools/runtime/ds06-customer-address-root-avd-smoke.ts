import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import pg from 'pg';
import { ReviewAvdScope } from './food-cancellation-review-avd-smoke';

const evidenceRoot = resolve('.omp/work/h2-merchant-pricing-20261026/DS06/evidence');
const args = process.argv.slice(2);
const evidenceFlag = args.indexOf('--evidence-dir');
const emulatorApiFlag = args.indexOf('--emulator-api-base');
if (
  evidenceFlag < 0 ||
  args[evidenceFlag + 1] == null ||
  (emulatorApiFlag >= 0 && args[emulatorApiFlag + 1] == null) ||
  args.length !== (emulatorApiFlag < 0 ? 2 : 4)
) {
  throw Error(
    'Usage: customer-address-picker-root-avd-smoke.ts --evidence-dir <guard-allocated directory> [--emulator-api-base <authorized base>]',
  );
}
const emulatorApi = emulatorApiFlag < 0
  ? 'http://10.0.2.2:3046/api/mobile/v1/'
  : args[emulatorApiFlag + 1]!;
if (
  emulatorApi !== 'http://10.0.2.2:3046/api/mobile/v1/' &&
  emulatorApi !== 'http://127.0.0.1:3046/api/mobile/v1/'
) {
  throw Error('Emulator API base must be the authorized NAT or adb-reverse loopback fixture path');
}
const evidence = await realpath(args[evidenceFlag + 1]!);
const evidenceInfo = await stat(evidence);
if (!evidenceInfo.isDirectory() || !evidence.startsWith(`${evidenceRoot}/`)) {
  throw Error('Evidence directory must be guard-allocated below the delivery evidence root');
}

const scope = new ReviewAvdScope(240000);
const db = new pg.Client({
  connectionString: 'postgresql://cryptoclock@127.0.0.1:55446/bitpos_w01_fixture',
});
const api = 'http://127.0.0.1:3046/api/mobile/v1/';
const screenshots: Record<string, string> = {
  BITPOS_U12_ROOT_ADDRESS_PICKER_VISIBLE: 'U12-address-picker.png',
  BITPOS_U13_EDIT_ADDRESS_VISIBLE: 'U13-address-edit.png',
  BITPOS_U14_ADDRESS_PIN_UNAVAILABLE_VISIBLE: 'U14-address-pin-unavailable.png',
};
const account = randomUUID();
const session = randomUUID();
const device = randomUUID();
const homeAddress = `${account.slice(0, 24)}000000000001`;
const officeAddress = `${account.slice(0, 24)}000000000002`;
const access = randomBytes(32).toString('base64url');
const refresh = randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const captured = new Set<string>();
let privateDirectory: string | undefined;
let connected = false;
let adbReverseBefore = '';
let ownsAdbReverse3046 = false;
let flutterOutput = '';

async function adb(command: string[]) {
  const child = scope.track(spawn(
    '/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',
    ['-s', 'emulator-5554', ...command],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  ));
  const chunks: Buffer[] = [];
  child.stdout.on('data', (data) => chunks.push(data));
  child.stderr.on('data', (data) => chunks.push(data));
  assert.equal((await scope.wait(once(child, 'exit')))[0], 0);
  return Buffer.concat(chunks).toString();
}
async function removeOwnedAdbReverse3046() {
  const child = spawn(
    '/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',
    ['-s', 'emulator-5554', 'reverse', '--remove', 'tcp:3046'],
    { stdio: 'ignore' },
  );
  assert.equal((await once(child, 'exit'))[0], 0);
}


async function exclusiveWrite(path: string, bytes: string | Uint8Array) {
  await writeFile(join(evidence, path), bytes, { flag: 'wx' });
}
try {
  await db.connect();
  connected = true;
  assert.equal((await db.query('SELECT current_database() name')).rows[0].name, 'bitpos_w01_fixture');
  assert.equal((await fetch(`${api}branches`, { signal: scope.signal })).status, 200);

  await db.query(
    "INSERT INTO bitpos.mobile_accounts(id,auth_subject,locale) VALUES($1,$2,'en')",
    [account, randomUUID()],
  );
  await db.query(
    "INSERT INTO bitpos.mobile_sessions(id,account_id,device_id,access_hash,refresh_hash,access_expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '15 minutes',clock_timestamp()+interval '30 minutes')",
    [session, account, device, hash(access), hash(refresh)],
  );
  await db.query(
    'INSERT INTO bitpos.mobile_refresh_history(token_hash,session_id) VALUES($1,$2)',
    [hash(refresh), session],
  );
  await db.query(
    "INSERT INTO bitpos.mobile_addresses(id,account_id,label,recipient_name,phone,address_text,instructions,latitude_e7,longitude_e7) VALUES ($2,$1,'Home','Fixture Customer','+66812345678','Sukhumvit 49 · Khlong Tan Nuea','',137500000,1005000000),($3,$1,'Office','Fixture Customer','+66812345678','Sample building · Floor 5','',137600000,1005200000)",
    [account, homeAddress, officeAddress],
  );
  if (emulatorApi.startsWith('http://127.0.0.1:')) {
    adbReverseBefore = await adb(['reverse', '--list']);
    if (!adbReverseBefore.includes('tcp:3046')) {
      await adb(['reverse', 'tcp:3046', 'tcp:3046']);
      ownsAdbReverse3046 = true;
    }
  }


  privateDirectory = await mkdtemp(join(tmpdir(), 'bitpos-address-avd-'));
  const fixtureConfig = join(privateDirectory, 'fixture.json');
  await writeFile(
    fixtureConfig,
    JSON.stringify({
      BITPOS_FIXTURE: 'true',
      BITPOS_TEST_DEVICE_ID: device,
      BITPOS_TEST_SESSION_BASE64: Buffer.from(
        JSON.stringify({
          accountId: account,
          sessionId: session,
          accessToken: access,
          refreshToken: refresh,
          accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
          refreshExpiresAt: new Date(Date.now() + 1800000).toISOString(),
        }),
      ).toString('base64'),
      BITPOS_MOBILE_API: emulatorApi,
    }),
    { mode: 0o600, flag: 'wx' },
  );

  const child = scope.track(
    spawn(
      '/Users/cryptoclock/development/flutter/bin/flutter',
      [
        'test',
        'integration_test/delivery_address_picker_root_test.dart',
        '-d',
        'emulator-5554',
        `--dart-define-from-file=${fixtureConfig}`,
        '--no-enable-impeller',
        '--no-uninstall',
        '--no-pub',
      ],
      { cwd: 'apps/mobile-customer', stdio: ['ignore', 'pipe', 'pipe'] },
    ),
  );
  let capture = Promise.resolve();
  const observe = (chunk: Buffer) => {
    const output = chunk.toString();
    flutterOutput = (flutterOutput + output).slice(-32000);
    for (const [marker, screenshot] of Object.entries(screenshots)) {
      if (!output.includes(marker) || captured.has(marker)) continue;
      captured.add(marker);
      capture = capture.then(async () => {
        const adb = scope.track(
          spawn(
            '/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',
            ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          ),
        );
        const chunks: Buffer[] = [];
        adb.stdout.on('data', (data) => chunks.push(data));
        assert.equal((await scope.wait(once(adb, 'exit')))[0], 0);
        await exclusiveWrite(screenshot, Buffer.concat(chunks));
      });
      void capture.catch((error) => scope.abort(error));
    }
  };
  child.stdout.on('data', observe);
  child.stderr.on('data', observe);
  assert.equal((await scope.wait(once(child, 'exit')))[0], 0);
  await capture;
  assert.deepEqual([...captured].sort(), Object.keys(screenshots).sort());

  const effects = await db.query(
    'SELECT (SELECT count(*)::int FROM bitpos.online_food_orders WHERE account_id=$1) AS orders,(SELECT count(*)::int FROM bitpos.payments p JOIN bitpos.orders o ON o.id=p.order_id JOIN bitpos.online_food_orders f ON f.order_id=o.id WHERE f.account_id=$1) AS payments,(SELECT count(*)::int FROM bitpos.mobile_addresses WHERE account_id=$1) AS addresses,(SELECT count(*)::int FROM bitpos.mobile_addresses WHERE account_id=$1 AND NOT archived) AS active_addresses',
    [account],
  );
  assert.deepEqual(effects.rows[0], {
    orders: 0,
    payments: 0,
    addresses: 3,
    active_addresses: 2,
  });
  const savedPin = await db.query(
    'SELECT recipient_name,phone,instructions,latitude_e7,longitude_e7 FROM bitpos.mobile_addresses WHERE account_id=$1 AND label=$2 AND NOT archived',
    [account, 'Fresh edited'],
  );
  assert.deepEqual(savedPin.rows[0], {
    recipient_name: 'Fixture Customer',
    phone: '+66812345678',
    instructions: 'Blue gate',
    latitude_e7: 137500000,
    longitude_e7: 1005000000,
  });
  await exclusiveWrite(
    'receipt.json',
    `${JSON.stringify(
      {
        status: 'PASS_NATIVE_CUSTOMER_U12_U13_U14_ADDRESS_FLOW',
        fixture: 'Synthetic account/session against current local W01 fixture and loopback API; no live provider.',
        emulatorApi: emulatorApi,
        adbReverse3046: emulatorApi.startsWith('http://127.0.0.1:')
          ? (ownsAdbReverse3046 ? 'created-and-removed-by-runner' : 'pre-existing-preserved')
          : 'not-needed-for-nat-path',
        captures: Object.values(screenshots),
        checks: [
          'Customer root loaded a local API-backed delivery merchant and its owned addresses.',
          'U12 selected only an eligible address and reloaded the account-address result after add/edit/archive.',
          'U14 showed the explicitly unavailable-map manual-coordinate fallback; no tile, GPS or provider claim was made.',
          'U13 persisted the returned coordinates and edit; SQL verified the saved fields.',
          'No order or payment was created.',
        ],
        visualInspection: 'pending parent manual inspection of this newly captured run; no visual comparison claim is emitted by the runner.',
        limits: [
          'Synthetic local fixture only.',
          'No external map tile, GPS, provider, payment or actual-use operation.',
          'Not pixel-diff certification.',
        ],
        physicalTesting: 'deferred_by_user_2026-10-16',
      },
      null,
      2,
    )}\n`,
  );
  console.log('PASS_NATIVE_CUSTOMER_U12_U13_U14_ADDRESS_FLOW');
} catch (error) {
  // Session values only enter the private define file; redact defensively
  // before retaining compiler/device diagnostics, including timeout failures.
  const diagnostic = flutterOutput.replaceAll(access, '[redacted]').replaceAll(refresh, '[redacted]');
  await exclusiveWrite('failure.json', JSON.stringify({
    status: 'FAIL_RETAINED', error: String(error), diagnostic,
    markers: [...captured], fixture: true, emulatorApi,
    adbReverse3046: emulatorApi.startsWith('http://127.0.0.1:')
      ? (ownsAdbReverse3046 ? 'created-by-runner' : 'pre-existing-preserved')
      : 'not-needed-for-nat-path',
    limits: ['No native/API/SQL success inferred from a build or partial capture'],
  }, null, 2) + '\n');
  throw error;
} finally {
  if (ownsAdbReverse3046) await removeOwnedAdbReverse3046();
  scope.close();
  if (connected) {
    await db.query(
      'UPDATE bitpos.mobile_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE id=$1',
      [session],
    );
    await db.query(
      'UPDATE bitpos.mobile_accounts SET disabled_at=coalesce(disabled_at,clock_timestamp()) WHERE id=$1',
      [account],
    );
    await db.end();
  }
  if (privateDirectory != null) await rm(privateDirectory, { recursive: true, force: true });
}
