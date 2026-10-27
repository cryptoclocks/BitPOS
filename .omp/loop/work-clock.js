import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WorkClock, clockLine } from '../lib/work-clock.mjs';

export default function workTiming(pi) {
  const clock = new WorkClock(), tools = new Map();
  let context, timer, directory, file, session, diagnosticQueued = false;
  const main = ctx => ctx.agent.kind === 'main';
  const safe = fn => { try { return fn(); } catch { /* Timing cannot stop product work. */ } };
  function persist() {
    if (!file) return;
    const u = clock.snapshot();
    const data = { version: 1, session, agent: context.agent.id, kind: context.agent.kind, observedAt: Date.now(),
      pid: process.pid, unit: u, tools: [...tools.values()].map(t => ({ name: t.name, startedAt: t.startedAt, elapsedMs: Date.now() - t.startedAt,
        estimate: t.estimate, estimateSource: 'auto_not_timeout' })) };
    writeFileSync(file + '.tmp', JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); renameSync(file + '.tmp', file);
  }
  function paint() {
    if (!context?.hasUI) return;
    const lines = [clockLine(clock.snapshot())];
    for (const t of [...tools.values()].slice(-2)) lines.push(`  ${t.name} | ETA ${t.estimate} auto | actual ${Math.floor((Date.now() - t.startedAt) / 1000)}s`);
    if (main(context)) for (const name of readdirSync(directory).filter(n => n.endsWith('.json') && join(directory, n) !== file).slice(-30)) {
      const other = safe(() => JSON.parse(readFileSync(join(directory, name), 'utf8')));
      if (other?.unit?.status === 'running' && Date.now() - other.observedAt < 20000 && lines.length < 5) lines.push(clockLine(other.unit));
    }
    context.ui.setWidget('bitpos-work-clock', lines, { placement: 'belowEditor' });
  }
  function maybeDiagnose() {
    if (!main(context) || diagnosticQueued) return;
    // Child clocks publish an idempotent request flag. Only the parent queues an AI turn.
    const candidates = [{ path: file, data: { unit: clock.snapshot(), agent: context.agent.id } }];
    for (const name of readdirSync(directory).filter(n => n.endsWith('.json') && join(directory, n) !== file)) {
      const path = join(directory, name), data = safe(() => JSON.parse(readFileSync(path, 'utf8')));
      if (data && Date.now() - data.observedAt < 20000) candidates.push({ path, data });
    }
    for (const item of candidates) {
      const u = item.data.unit;
      if (!u?.overdue || u.diagnostic || u.reasons.length || u.diagnosticState !== 'none') continue;
      if (clock.snapshot()?.reasons.some(reason => ['provider_retry', 'provider_blocked', 'operator', 'session_closed'].includes(reason))) return;
      const marker = join(directory, 'diagnostic-' + createHash('sha256').update(String(u.startedAt) + u.id + item.data.agent).digest('hex').slice(0, 24) + '.request');
      try { writeFileSync(marker, JSON.stringify({ unit: u.id, unitFile: item.path, agent: item.data.agent, at: Date.now() }), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      const content = `Timing overrun request (agent-generated, human-authorized diagnostic only). Unit ${u.label}: estimate ${u.lowMinutes}–${u.highMinutes}min; active ${Math.floor(u.activeMs / 60000)}min, wall ${Math.floor(u.elapsedMs / 60000)}min. Read current ${item.path}; if already finished or quota-waiting, skip. Otherwise dispatch ONE native read-only openai-codex/gpt-6.1-sol:high diagnostic, scoped to this delayed unit. Compare current output and bounded timestamps; identify actual bottleneck, repeated unchanged checks, dependencies versus progress, and minimal recommendation. No product edits/tests/review cascade, no kill/restart, no children from diagnostician. Do not mark acceptance or change quotas/security. Write a concise task-local diagnosis or return it as text. This is not a correctness review. Request marker ${marker}.`;
      pi.sendMessage({ customType: 'bitpos-clock-overrun', content, display: true }, { deliverAs: 'followUp', triggerTurn: true });
      diagnosticQueued = true; if (item.path === file) clock.reserveDiagnosis();
      break;
    }
  }
  pi.on('session_start', (_event, ctx) => {
    context = ctx; session = ctx.sessionManager.getSessionId();
    directory = join(ctx.cwd, '.omp/work/timing'); mkdirSync(directory, { recursive: true, mode: 0o700 });
    file = join(directory, 'agent-' + createHash('sha256').update(session).digest('hex').slice(0, 20) + '.json');
    // No retrospective estimate/start time is invented for an in-flight task.
    safe(() => { persist(); paint(); });
    timer = setInterval(() => safe(() => { persist(); paint(); maybeDiagnose(); }), 5000); timer.unref?.();
  });
  pi.on('agent_start', (_event, ctx) => {
    context = ctx;
    if (!clock.unit || clock.unit.status !== 'running') clock.start({ id: ctx.agent.id + '-' + Date.now(), label: ctx.agent.id,
      lowMinutes: main(ctx) ? null : 15, highMinutes: main(ctx) ? null : 30, estimateSource: main(ctx) ? 'unknown' : 'auto',
      diagnostic: /(?:delay|clock|timing).*(?:high|review|diagnos)/i.test(ctx.agent.id + ' ' + ctx.agent.name) });
    safe(() => { persist(); paint(); });
  });
  pi.on('agent_end', (event, ctx) => { if (!event.willContinue) { clock.finish(); safe(() => { persist(); paint(); }); } });
  pi.on('tool_execution_start', (event, ctx) => {
    context = ctx;
    tools.set(event.toolCallId, { name: event.toolName, startedAt: Date.now(), estimate: event.toolName === 'bash' ? '1–5m' : event.toolName === 'task' ? '<1m dispatch' : event.toolName === 'wait' ? 'dependency' : '<1m' });
    if (event.toolName === 'wait') clock.pause('dependency');
    safe(() => { persist(); paint(); });
  });
  pi.on('tool_execution_end', event => {
    tools.delete(event.toolCallId);
    if (event.toolName === 'wait' && ![...tools.values()].some(t => t.name === 'wait')) clock.resume('dependency');
    safe(() => { persist(); paint(); });
  });
  pi.on('auto_retry_start', () => { clock.pause('provider_retry'); safe(persist); });
  pi.on('auto_retry_end', event => { if (event.success) { clock.resume('provider_retry'); clock.resume('provider_blocked'); } else clock.pause('provider_blocked'); safe(persist); });
  pi.on('session_shutdown', () => { if (timer) clearInterval(timer); clock.pause('session_closed'); safe(persist); });
  pi.registerCommand('clock', {
    description: 'Work timer: status | start LOW HIGH LABEL | done | pause | resume | diagnosis-done. Minutes; no restart/model call.',
    handler: async (args, ctx) => {
      context = ctx;
      try {
        const [op = 'status', low, high, ...label] = args.trim().split(/\s+/).filter(Boolean);
        if (op === 'start' && label.length) {
          if (clock.unit?.status === 'running') clock.finish('superseded');
          diagnosticQueued = false; clock.start({ id: ctx.agent.id + '-' + Date.now(), label: label.join(' '), lowMinutes: Number(low), highMinutes: Number(high), estimateSource: 'model' });
        } else if (op === 'diagnosis-done') diagnosticQueued = false;
        else if (op === 'done') clock.finish();
        else if (op === 'pause') clock.pause('operator');
        else if (op === 'resume') clock.resume('operator');
        else if (op !== 'status') throw Error('Usage: /clock start 10 20 P22 directory | status | done | pause | resume');
        safe(() => { persist(); paint(); }); ctx.ui.notify(clockLine(clock.snapshot()), 'info');
      } catch (error) { ctx.ui.notify(error.message, 'warning'); }
    },
  });
  const T = pi.typebox?.Type ?? pi.typebox;
  if (T) pi.registerTool({ name: 'work_clock', label: 'Work ETA / elapsed', approval: 'write',
    description: 'Optional: set an honest estimate once per coherent work unit, or mark it done/pause/resume. Timing only; never an acceptance gate.',
    parameters: T.Object({ op: T.Union(['start', 'done', 'pause', 'resume', 'status', 'diagnosis_done'].map(x => T.Literal(x))),
      label: T.Optional(T.String()), lowMinutes: T.Optional(T.Number()), highMinutes: T.Optional(T.Number()) }),
    async execute(_id, args, _signal, _update, ctx) {
      context = ctx;
      if (args.op === 'start') {
        if (!(args.lowMinutes > 0 && args.highMinutes >= args.lowMinutes && args.highMinutes <= 1440 && args.label)) return { content: [{ type: 'text', text: 'Valid label and estimate range required.' }], isError: true };
        if (clock.unit?.status === 'running') clock.finish('superseded');
        diagnosticQueued = false; clock.start({ id: ctx.agent.id + '-' + Date.now(), label: args.label, lowMinutes: args.lowMinutes, highMinutes: args.highMinutes, estimateSource: 'model' });
      } else if (args.op === 'diagnosis_done') diagnosticQueued = false;
      else if (args.op === 'done') clock.finish();
      else if (args.op === 'pause') clock.pause('operator');
      else if (args.op === 'resume') clock.resume('operator');
      safe(() => { persist(); paint(); });
      return { content: [{ type: 'text', text: clockLine(clock.snapshot()) }], details: clock.snapshot() };
    },
  });
}
