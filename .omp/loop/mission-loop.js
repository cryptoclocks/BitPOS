import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';

export default function bitposLoop(pi) {
  const root = process.env.BITPOS_HARNESS_ROOT || '/Users/cryptoclock/Desktop/BitPOS';
  const main = ctx => ctx.agent.kind === 'main';
  const persist = (name, data) => {
    const dir = join(root, '.omp/work/loop'); mkdirSync(dir, { recursive: true });
    const path = join(dir, name); writeFileSync(path + '.tmp', JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); renameSync(path + '.tmp', path);
  };
  const model = ctx => ctx.model?.provider + '/' + ctx.model?.id;
  const gate = () => {
    const result = spawnSync('/usr/bin/python3', [join(root, '.omp/foreman.py'), 'gate'], { cwd: root, encoding: 'utf8', timeout: 20000 });
    return { ok: result.status === 0, reason: result.stdout || 'Gate failed' };
  };
  pi.on('session_start', (_event, ctx) => {
    if (!main(ctx)) return;
    if (model(ctx) !== 'openai-codex/gpt-6.1-sol' || pi.getThinkingLevel() !== 'low') throw new Error('BitPOS owner must resolve to Sol 6.1 low');
    persist('runtime-ready.json', { hook: 'bitpos-native-v1', model: model(ctx), thinking: pi.getThinkingLevel(), session_id: ctx.sessionManager.getSessionId(), run_id: process.env.BITPOS_RUN_ID, loaded_at: new Date().toISOString() });
    if (ctx.hasUI) ctx.ui.notify('BitPOS: isolated native tasks; independent Sol high review gate active.', 'info');
  });
  pi.on('tool_call', (event, ctx) => {
    if (event.toolName === 'goal') {
      if (!main(ctx)) return { block: true, reason: 'Only coordinator owns the persistent goal.' };
      if (['create', 'drop'].includes(event.input?.op)) return { block: true, reason: 'Preserve the current goal/session; do not replace accounting.' };
      if (event.input?.op === 'complete') {
        const result = gate();
        if (!result.ok) return { block: true, reason: result.reason };
      }
    }
    if (ctx.agent.name === 'final-reviewer' && ['edit', 'write'].includes(event.toolName)) {
      const target = event.input?.path || event.input?.file_path;
      const allowed = join(root, '.omp/work/reviews') + '/';
      if (!target || !resolve(ctx.cwd, target).startsWith(allowed)) return { block: true, reason: 'Reviewer may write review artifacts only.' };
    }
  });
  pi.on('agent_start', (_event, ctx) => {
    if (main(ctx) || ctx.agent.name !== 'final-reviewer') return;
    if (model(ctx) !== 'openai-codex/gpt-6.1-sol' || pi.getThinkingLevel() !== 'high') throw new Error('Independent reviewer must resolve to Sol 6.1 high');
    const request = JSON.parse(readFileSync(join(root, '.omp/work/loop/review-request.json'), 'utf8'));
    persist('review-provenance.json', { ...request, model: model(ctx), thinking: pi.getThinkingLevel(), session_id: ctx.sessionManager.getSessionId(), reviewer_finished: false });
  });
  pi.on('agent_end', (event, ctx) => {
    if (event.willContinue || main(ctx) || ctx.agent.name !== 'final-reviewer') return;
    const file = join(root, '.omp/work/loop/review-provenance.json');
    const previous = JSON.parse(readFileSync(file, 'utf8'));
    if (previous.session_id === ctx.sessionManager.getSessionId()) persist('review-provenance.json', { ...previous, reviewer_finished: true });
  });
  pi.on('auto_retry_start', (event, ctx) => {
    if (main(ctx)) persist('provider-wait.json', { status: 'waiting', model: model(ctx), delay_ms: event.delayMs, resume_not_before: new Date(Date.now() + event.delayMs).toISOString(), attempt: event.attempt });
  });
  pi.on('auto_retry_end', (event, ctx) => {
    if (!main(ctx)) return;
    persist('provider-wait.json', { status: event.success ? 'resumed' : 'blocked', finished_at: new Date().toISOString() });
    if (!event.success) {
      ctx.abort();
      if (ctx.hasUI) ctx.ui.notify('Provider retry exhausted; goal paused. Inspect checkpoint and credentials/reset before resuming.', 'warning');
    }
  });
}
