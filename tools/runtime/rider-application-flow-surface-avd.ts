// Existing Pixel AVD only. Local presentation fixtures; no API, document upload, verifier, GPS, payment, or database operation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const stamp = new Date().toISOString().replaceAll(':', '-');
const root = '.omp/work/flutter-delivery-20261016/evidence/rider-application-flow-g7k4p';
const evidence = `${root}/native-${stamp}.json`;
const scratch = await mkdtemp(join(tmpdir(), 'bitpos-rider-application-'));
const stages = ['R03_TH', 'R04_TH', 'R05_TH', 'R03_EN', 'R04_EN', 'R05_EN'];
const captured = new Set<string>();
const captures: {path: string; sha256: string}[] = [];
const receipt: Record<string, unknown> = {
  status: 'RUNNING',
  fixture: true,
  captures,
  scratchDirectory: scratch,
  physicalTesting: 'deferred_by_user_2026-10-16',
  limits: [
    'Native R03/R04/R05 local presentation fixture only',
    'No API, document upload, verifier, GPS, payment, or database operation',
    'No full fidelity or platform acceptance inferred',
  ],
};
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function adb(...args: string[]) {
  const child = spawn('/Users/cryptoclock/Library/Android/sdk/platform-tools/adb', ['-s', 'emulator-5554', ...args], {stdio: ['ignore', 'pipe', 'pipe']});
  const chunks: Buffer[] = [];
  child.stdout.on('data', bytes => chunks.push(bytes));
  assert.equal((await once(child, 'exit'))[0], 0);
  return Buffer.concat(chunks);
}
try {
  assert.equal((await adb('get-state')).toString().trim(), 'device');
  let log = '';
  let capturesDone = Promise.resolve();
  const child = spawn('/Users/cryptoclock/development/flutter/bin/flutter', ['test', 'integration_test/application_flow_surface_test.dart', '-d', 'emulator-5554', '--no-enable-impeller', '--no-uninstall'], {cwd: 'apps/mobile-driver', stdio: ['ignore', 'pipe', 'pipe']});
  const observe = (chunk: Buffer) => {
    process.stdout.write(chunk);
    log = (log + chunk.toString()).slice(-24000);
    for (const stage of stages) {
      if (captured.has(stage) || !log.includes(`BITPOS_RIDER_APPLICATION_${stage}`)) continue;
      captured.add(stage);
      capturesDone = capturesDone.then(async () => {
        const path = join(scratch, `rider-application-${stage.toLowerCase()}-${stamp}.png`);
        const bytes = await adb('exec-out', 'screencap', '-p');
        assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
        await writeFile(path, bytes, {flag: 'wx'});
        captures.push({path, sha256: hash(bytes)});
      });
    }
  };
  child.stdout.on('data', observe);
  child.stderr.on('data', observe);
  const exitCode = (await once(child, 'exit'))[0];
  receipt.diagnosticOutput = log;
  await capturesDone;
  assert.equal(captured.size, stages.length);
  receipt.flutterExitCode = exitCode;
  receipt.sourceHashes = Object.fromEntries(await Promise.all([
    'apps/mobile-driver/lib/presentation/driver_application_flow.dart',
    'apps/mobile-driver/integration_test/application_flow_surface_test.dart',
    'tools/runtime/rider-application-flow-surface-avd.ts',
  ].map(async path => [path, hash(await readFile(path))])));
  if (exitCode === 0) {
    receipt.status = 'PASS_BOUNDED_NATIVE_RIDER_APPLICATION_FIXTURES';
  } else {
    receipt.status = 'PARTIAL_NATIVE_CAPTURES_WITH_FLUTTER_FAILURE';
    receipt.error = 'Flutter emitted all fixture capture markers but exited nonzero; retain terminal output before interpreting captures.';
    process.exitCode = 1;
  }
} catch (error) {
  receipt.status = 'FAIL_RETAINED';
  receipt.error = String(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await writeFile(evidence, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({status: receipt.status, evidence, error: receipt.error}));
}
