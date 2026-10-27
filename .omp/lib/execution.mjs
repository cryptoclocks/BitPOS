import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { saveJson } from './efficiency.mjs';

export const ROUTES = Object.freeze({
  owner: 'openai-codex/gpt-6.1-sol:low',
  'customer-ui': 'openai-codex/gpt-5.6-terra:medium',
  'rider-ui': 'openai-codex/gpt-5.6-terra:medium',
  'pos-web': 'openai-codex/gpt-5.6-terra:medium',
  task: 'openai-codex/gpt-5.6-terra:medium',
  'payment-backend': 'openai-codex/gpt-6.1-sol:low',
  firmware: 'openai-codex/gpt-6.1-sol:low',
  'mobile-reviewer': 'openai-codex/gpt-6.1-sol:high',
  'final-reviewer': 'openai-codex/gpt-6.1-sol:high',
});
export function executionSettings(root) {
  try {
    const config = JSON.parse(readFileSync(join(root, '.omp/execution.json'), 'utf8'));
    if (config.version !== 1 || typeof config.enabled !== 'boolean') throw Error('Invalid execution policy');
    return { version: 1, enabled: config.enabled };
  } catch (error) {
    return { version: 1, enabled: error.code === 'ENOENT',
      ...(error.code === 'ENOENT' ? {} : { error: 'Invalid optimization settings; base mission gates remain binding.' }) };
  }
}
export function setExecution(root, enabled) {
  const config = { version: 1, enabled };
  saveJson(join(root, '.omp/execution.json'), config);
  return config;
}

export function executionPolicy(root) {
  const settings = executionSettings(root);
  if (!settings.enabled) return 'BITPOS_EXECUTION: OFF. Use base proportional mission verification; authorized model routes, permissions and final gates remain binding.';
  return [
    'BITPOS_EXECUTION: ON (human 2026-10-24). SAME goal; UI-first, local-only.',
    'Routine Customer/Rider/POS UI children: openai-codex/gpt-5.6-terra:medium; owner Sol6.1 low.',
    'Use explicit :medium selector and OMIT coarse effort field: effort:med resolves HIGH for Terra on OMP18.6.',
    'Max3 native children, isolated:false with exclusive file leases; parent owns shared contracts/themes/router and coordinates AVD/build outputs.',
    'Authors implement coherent multi-screen batches and self-check FigCraft, states, navigation and focused tests. No separate scout before routine implementation.',
    'No HIGH review per widget/helper/screenshot or unchanged boundary; one independent Sol6.1 HIGH review per completed surface batch.',
    'Auth/tenant/payment/stock/refund/dispatch-authority/schema changes and open safety findings retain focused independent review; full final gate unchanged.',
    'Reuse only unchanged source/evidence-bound checks. After2 failed same-step attempts diagnose the exact cause before another run.',
    'Session corrections: read docs/OMP_SESSION_GUARDS_TH.md once. Use .omp/guard run for repeated local test/build steps, dir/seal/verify for immutable current-file bindings, preflight for local runtime/schema/deadline readiness.',
    'Author measures actual settled UI against reference before HIGH; no grid/presence-only fidelity claim. Fix all original findings together, retain one reviewer; metadata-only corrections require no product test rerun.',
    'Recover an ambiguous committed request first. Once its outcome is known, a separate authorized local fixture scenario may proceed; retain prior failure, never rewrite deadlines or ask again for routine local test data. Codex steering is coordination, not new human authority.',
    'Read bounded pointers; checkpoint once per completed batch/blocker. No finance/API sidequests unless an active security defect.',
    'Upstream mandatory arena/parallel-design/scout/skill chains do not apply to routine UI or function edits; use the existing design and contracts.',
    'Native account/quota recovery retained; no provider switch or silent model escalation. Policy: docs/OMP_EXECUTION_POLICY_TH.md.',
  ].join('\n');
}
