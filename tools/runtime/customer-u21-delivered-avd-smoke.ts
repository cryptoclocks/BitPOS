import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';

const adb = '/Users/cryptoclock/Library/Android/sdk/platform-tools/adb';
const evidence = '.omp/work/flutter-delivery-20261016/evidence';
const date = '20261021';
execFileSync(adb, ['-s', 'emulator-5554', 'shell', 'wm', 'size', '1024x2216']);
execFileSync(adb, ['-s', 'emulator-5554', 'shell', 'wm', 'density', '420']);
await new Promise((resolve) => setTimeout(resolve, 1500));
const flutter = spawn(
  '/Users/cryptoclock/development/flutter/bin/flutter',
  [
    'test',
    'integration_test/customer_u21_delivered_root_test.dart',
    '-d',
    'emulator-5554',
    '--no-enable-impeller',
    '--no-uninstall',
  ],
  {cwd: 'apps/mobile-customer', stdio: ['ignore', 'pipe', 'pipe']},
);
let output = '';
let geometry = '';
let captured = false;
let screenshot = Promise.resolve();
const observe = (chunk: Buffer) => {
  const text = chunk.toString();
  process.stdout.write(text);
  output = (output + text).slice(-12000);
  const match = /BITPOS_U21_GEOMETRY:([^\r\n]+)/.exec(output);
  if (match) geometry = match[1];
  if (captured || !text.includes('BITPOS_U21_ROOT_AVD_VISIBLE')) return;
  captured = true;
  screenshot = (async () => {
    const image = spawn(adb, ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    image.stdout.on('data', (part) => chunks.push(part));
    const [code] = await once(image, 'exit');
    assert.equal(code, 0);
    await writeFile(
      `${evidence}/customer-u21-delivered-avd-direct-${date}.png`,
      Buffer.concat(chunks),
    );
  })();
  void screenshot.catch((error) => {
    throw error;
  });
};
flutter.stdout.on('data', observe);
flutter.stderr.on('data', observe);
const [exitCode] = await once(flutter, 'exit');
await screenshot;
execFileSync(adb, ['-s', 'emulator-5554', 'shell', 'wm', 'size', 'reset']);
execFileSync(adb, ['-s', 'emulator-5554', 'shell', 'wm', 'density', 'reset']);
assert.equal(exitCode, 0, output);
assert.ok(captured, 'U21 AVD screenshot marker missing');
assert.ok(geometry, 'U21 AVD geometry receipt missing');
await writeFile(
  `${evidence}/customer-u21-delivered-avd-direct-${date}.json`,
  `${JSON.stringify(
    {
      date: '2026-10-21',
      status: 'PASS_CUSTOMER_U21_DELIVERED_ROOT_AVD_FIGCRAFT_GEOMETRY',
      native: {
        device: 'emulator-5554',
        integration: 'customer_u21_delivered_root_test.dart',
        result: 'PASS',
        screenshot: `customer-u21-delivered-avd-direct-${date}.png`,
        geometry,
      },
      fixture:
        'In-memory review snapshot used only for delivered-page route geometry. Server-confirmed DELIVERED/API eligibility behavior is covered separately by food_review_page_test.dart and food_delivery_test.dart.',
      limits: [
        'This root AVD geometry run does not prove API/SQL state or payment.',
        'Screenshot manually inspected against U21-delivered.svg; no full-page automated pixel diff.',
        'No review was submitted and no receipt action was performed.',
      ],
      physicalTesting: 'deferred_by_user_2026-10-16',
    },
    null,
    2,
  )}\n`,
);
console.log(`PASS_U21_DELIVERED_ROOT_AVD ${geometry}`);
