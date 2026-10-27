import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';

const evidence = '.omp/work/flutter-delivery-20261016/evidence';
const screenshot = `${evidence}/customer-u25-refund-tracking-avd-20261020.png`;
const receipt = `${evidence}/customer-u25-refund-tracking-avd-20261020.json`;
const flutter = spawn(
  '/Users/cryptoclock/development/flutter/bin/flutter',
  [
    'test',
    'integration_test/refund_tracking_visual_test.dart',
    '-d',
    'emulator-5554',
    '--no-enable-impeller',
    '--no-uninstall',
    '--no-pub',
  ],
  { cwd: 'apps/mobile-customer', stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '';
let captured = false;
let capture = Promise.resolve();
const observe = (chunk: Buffer) => {
  const text = chunk.toString();
  output = (output + text).slice(-30000);
  process.stdout.write(text);
  if (!captured && output.includes('BITPOS_U25_REFUND_PAGE_VISIBLE')) {
    captured = true;
    capture = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        const adb = spawn(
          '/Users/cryptoclock/Library/Android/sdk/platform-tools/adb',
          ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p'],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        const chunks: Buffer[] = [];
        adb.stdout.on('data', (data: Buffer) => chunks.push(data));
        adb.once('error', reject);
        adb.once('exit', (code) => {
          if (code !== 0) return reject(new Error(`ADB_SCREENSHOT_EXIT_${code}`));
          void writeFile(screenshot, Buffer.concat(chunks)).then(resolve, reject);
        });
      }, 300);
    });
  }
};
flutter.stdout.on('data', observe);
flutter.stderr.on('data', observe);
flutter.once('error', (error) => {
  throw error;
});
const [code] = (await once(flutter, 'exit')) as [number | null];
assert.equal(code, 0, output.slice(-8000));
assert.equal(captured, true, 'U25 visibility marker was not emitted');
await capture;
const sha256 = async (path: string) =>
  createHash('sha256').update(await readFile(path)).digest('hex');
const sourceFiles = [
  'apps/mobile-customer/lib/order_refunds_sheet.dart',
  'apps/mobile-customer/lib/food_page.dart',
  'apps/mobile-customer/lib/presentation/customer_navigation.dart',
  'apps/mobile-customer/integration_test/refund_tracking_visual_test.dart',
];
const sourceSha256 = Object.fromEntries(
  await Promise.all(sourceFiles.map(async (path) => [path, await sha256(path)])),
);
await writeFile(
  receipt,
  JSON.stringify(
    {
      status: 'PASS_NATIVE_U25_REFUND_TRACKING_FIXTURE',
      fixture: 'Synthetic UI-only refund obligation; no HTTP order creation, payment or refund transfer.',
      checks: [
        'Native Android AVD rendered the full U25 status page and recorded order context',
        'View order status and Contact support callbacks fired',
        'Customer Orders tab remained visible and its root callback fired',
        'Refund text distinguishes an obligation from verified transfer proof',
      ],
      screenshot: screenshot.split('/').at(-1),
      screenshotSha256: await sha256(screenshot),
      sourceSha256,
      limits: [
        'Synthetic fixture only; no provider integration or actual refund execution',
        'Screenshot manually compared to FigCraft; no automated pixel-diff certification',
        'Physical GPS/device tests are outside this screen scope',
      ],
    },
    null,
    2,
  ) + '\n',
);
console.log('PASS_NATIVE_U25_REFUND_TRACKING_FIXTURE');
