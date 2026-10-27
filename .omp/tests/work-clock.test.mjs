import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkClock, clockLine } from '../lib/work-clock.mjs';
import extension from '../loop/work-clock.js';

test('wall, active, overlapping waits and unobserved gaps remain separate', () => {
  let at = 1000; const c = new WorkClock({ now: () => at, gapLimitMs: 10000 });
  c.start({ id: 'P22', label: 'Directory', lowMinutes: 1, highMinutes: 2, estimateSource: 'model' });
  at += 5000; c.pause('quota'); at += 4000; c.pause('dependency'); at += 3000; c.resume('quota'); at += 2000; c.resume('dependency');
  at += 6000; c.sample(); at += 30000; const u = c.snapshot();
  assert.equal(u.activeMs, 11000); assert.equal(u.waitMs, 9000); assert.equal(u.unknownMs, 30000); assert.equal(u.elapsedMs, 50000);
  assert.equal(u.activeMs + u.waitMs + u.unknownMs, u.elapsedMs);
  assert.match(clockLine(u), /ETA 1–2m/); assert.match(clockLine(u), /unobserved 30s/);
});
test('unknown ETA never fabricates a retrospective baseline or automatic overrun', () => {
  let at = 0; const c = new WorkClock({ now: () => at, gapLimitMs: Infinity });
  c.start({ id: 'legacy', label: 'Existing job' }); at += 36000000;
  assert.equal(c.snapshot().overdue, false); assert.equal(c.snapshot().thresholdMs, null); assert.match(clockLine(c.snapshot()), /ETA unknown/);
});
test('overrun uses active time and queues one diagnosis; quota and diagnostics cannot self-escalate', () => {
  let at = 0; const c = new WorkClock({ now: () => at, gapLimitMs: Infinity });
  c.start({ id: 'geometry', label: 'P22', lowMinutes: 2, highMinutes: 5 });
  at = 15 * 60000; c.pause('provider_retry'); assert.equal(c.reserveDiagnosis(), false);
  at += 60 * 60000; c.resume('provider_retry'); assert.equal(c.snapshot().activeMs, 15 * 60000);
  assert.equal(c.reserveDiagnosis(), true); assert.equal(c.reserveDiagnosis(), false);
  c.finish(); assert.equal(c.snapshot().overdue, false);
  c.start({ id: 'diagnostic', label: 'Delay analysis', lowMinutes: 1, highMinutes: 2, diagnostic: true }); at += 30 * 60000;
  assert.equal(c.reserveDiagnosis(), false);
});
test('re-estimating retains original budget and cannot erase an overrun', () => {
  let at = 0; const c = new WorkClock({ now: () => at, gapLimitMs: Infinity });
  c.start({ id: 'unit', label: 'P23', lowMinutes: 2, highMinutes: 5 });
  at = 16 * 60000; c.estimate(30, 60); assert.equal(c.snapshot().overdue, true);
  assert.equal(c.snapshot().originalEstimate.highMinutes, 5);
  assert.throws(() => c.start({ id: 'new', label: 'new' }), /Finish/);
});
test('completed units freeze duration and invalid estimates do not enter the ledger', () => {
  let at = 0; const c = new WorkClock({ now: () => at });
  assert.throws(() => c.start({ id: 'bad', label: 'bad', lowMinutes: 5, highMinutes: 2 }), /Invalid/);
  c.start({ id: 'done', label: 'done', lowMinutes: 1, highMinutes: 2 }); at = 2000; c.finish(); at = 5000;
  assert.equal(c.snapshot().elapsedMs, 2000); assert.equal(c.snapshot().activeMs, 2000);
});
test('extension registers timing UI and optional tool without changing product tool results or starting a model', async t => {
  const root = mkdtempSync(join(tmpdir(), 'bitpos-clock-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const hooks = {}, commands = {}, widgets = [], messages = [], registered = [];
  const Type = { Object: x => x, Optional: x => x, Union: x => x, Literal: x => x, String: () => ({}), Number: () => ({}) };
  extension({ typebox: { Type }, on: (name, fn) => hooks[name] = fn, registerCommand: (name, x) => commands[name] = x,
    registerTool: x => registered.push(x), sendMessage: x => messages.push(x) });
  const ctx = { cwd: root, hasUI: true, agent: { kind: 'main', id: 'Main', name: 'main' }, sessionManager: { getSessionId: () => 'test' }, ui: { setWidget: (...x) => widgets.push(x), notify: () => {} } };
  hooks.session_start({}, ctx); hooks.agent_start({}, ctx);
  const tool = registered[0]; assert.equal(tool.name, 'work_clock');
  await tool.execute('clock1', { op: 'start', label: 'P22 geometry', lowMinutes: 10, highMinutes: 20 }, undefined, undefined, ctx);
  hooks.tool_execution_start({ toolName: 'bash', toolCallId: 'b1', args: { command: 'private-secret-command' } }, ctx);
  assert.match(widgets.at(-1)[1].join('\n'), /P22 geometry.*ETA 10–20m/);
  const statePath = join(root, '.omp/work/timing', readdirSync(join(root, '.omp/work/timing')).find(x => x.endsWith('.json')));
  assert.ok(!readFileSync(statePath, 'utf8').includes('private-secret-command'));
  hooks.tool_execution_end({ toolName: 'bash', toolCallId: 'b1', result: 'unchanged' }, ctx);
  hooks.auto_retry_start({}, ctx); assert.match(widgets.at(-1)[1].join('\n'), /P22/);
  hooks.auto_retry_end({ success: true }, ctx);
  assert.equal(messages.length, 0); assert.equal(hooks.tool_call, undefined); assert.equal(hooks.tool_result, undefined);
  hooks.session_shutdown({}, ctx);
});
