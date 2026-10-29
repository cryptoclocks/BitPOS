import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const directory = `.omp/work/flutter-delivery-20261016/evidence/customer-order-phase-root-${new Date().toISOString().replaceAll(':', '-')}`;
await mkdir(directory, {recursive: true});
const child = spawn('/Users/cryptoclock/development/flutter/bin/flutter', ['test', '--no-pub', 'integration_test/food_order_phase_root_test.dart', '-d', 'emulator-5554', '--no-enable-impeller', '--no-uninstall'], {cwd: 'apps/mobile-customer', stdio: ['ignore', 'pipe', 'pipe']});
let output = '', pending = Promise.resolve();
const stages = new Set(), captures = [];
function observe(chunk) {
  process.stdout.write(chunk);
  output += chunk.toString();
  for (const match of output.matchAll(/BITPOS_ORDER_PHASE_CAPTURE:([A-Za-z0-9-]+)/g)) {
    const stage = match[1];
    if (stages.has(stage)) continue;
    stages.add(stage);
    pending = pending.then(async () => {
      const shot = spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb', ['-s', 'emulator-5554', 'exec-out', 'screencap', '-p']);
      const chunks = [];
      shot.stdout.on('data', part => chunks.push(part));
      const exit = await new Promise((resolve, reject) => {shot.on('error', reject); shot.on('close', resolve);});
      assert.equal(exit, 0);
      const bytes = Buffer.concat(chunks), path = `${directory}/${stage}.png`;
      await writeFile(path, bytes);
      captures.push({path, sha256: createHash('sha256').update(bytes).digest('hex')});
    });
  }
}
child.stdout.on('data', observe);
child.stderr.on('data', observe);
const exit = await new Promise((resolve, reject) => {child.on('error', reject); child.on('close', resolve);});
await pending;
await writeFile(`${directory}/run.log`, output);
const receipt = {exit, captures, fixture: 'Actual CustomerSessionPage on authorized AVD with synthetic in-process API snapshots; no joined HTTP/SQL proof', physicalTesting: 'deferred_by_user_2026-10-16'};
await writeFile(`${directory}/receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
assert.equal(exit, 0);
assert.equal(captures.length, 9);
console.log(JSON.stringify({directory, ...receipt}));
