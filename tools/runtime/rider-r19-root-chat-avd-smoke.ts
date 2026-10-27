import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';

const adb = '/Users/cryptoclock/Library/Android/sdk/platform-tools/adb';
const evidence = '.omp/work/flutter-delivery-20261016/evidence';
const date = '20261021';
execFileSync(adb, ['-s', 'emulator-5554', 'shell', 'wm', 'size', '1024x2216']);
execFileSync(adb, ['-s', 'emulator-5554', 'shell', 'wm', 'density', '420']);
const flutter = spawn(
  '/Users/cryptoclock/development/flutter/bin/flutter',
  [
    'test',
    'integration_test/rider_chat_root_test.dart',
    '-d',
    'emulator-5554',
    '--no-enable-impeller',
    '--no-uninstall',
  ],
  {cwd: 'apps/mobile-driver', stdio: ['ignore', 'pipe', 'pipe']},
);
let output = '';
let geometry = '';
let captured = false;
let screenshot = Promise.resolve();
const observe = (chunk: Buffer) => {
  const text = chunk.toString();
  process.stdout.write(text);
  output = (output + text).slice(-12000);
  const match = /BITPOS_R19_ROOT_GEOMETRY:([^\r\n]+)/.exec(output);
  if (match) geometry = match[1];
  if (captured || !text.includes('BITPOS_R19_ROOT_AVD_VISIBLE')) return;
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
      `${evidence}/rider-r19-root-chat-avd-direct-${date}.png`,
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
assert.ok(captured, 'R19 AVD screenshot marker missing');
assert.ok(geometry, 'R19 AVD geometry receipt missing');
await writeFile(
  `${evidence}/rider-r19-root-chat-avd-direct-${date}.json`,
  `${JSON.stringify(
    {
      date: '2026-10-21',
      status: 'PASS_RIDER_ASSIGNMENT_TO_CHAT_ROOT_AVD_FIGCRAFT_GEOMETRY',
      native: {
        device: 'emulator-5554',
        integration: 'rider_chat_root_test.dart',
        result: 'PASS',
        screenshot: `rider-r19-root-chat-avd-direct-${date}.png`,
        geometry,
      },
      fixture:
        'In-memory LiveWorkApi assignment and chat fixture for rider root navigation and geometry only. Actual HTTP/SSE/text/photo/read/logout acceptance is separately evidenced in food-chat105-multi-gallery-actual-avd-20261020.json.',
      limits: [
        'No API/SQL or provider proof in this root AVD run.',
        'Selected geometry and screenshot were manually inspected; no full-page automated pixel diff.',
        'Physical delivery/GPS testing remains deferred by user.',
      ],
      physicalTesting: 'deferred_by_user_2026-10-16',
    },
    null,
    2,
  )}\n`,
);
console.log(`PASS_R19_ROOT_AVD ${geometry}`);
