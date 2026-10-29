import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const FAMILIES = Object.freeze(['ponytail', 'unlazy', 'autoprompt', 'matt-pocock', 'superpowers']);
export const DEFAULTS = Object.freeze({ version: 2, enabled: true,
  skills: Object.freeze(Object.fromEntries(FAMILIES.map(name => [name, true]))) });
const defaults = () => ({ ...DEFAULTS, skills: { ...DEFAULTS.skills } });
export const digest = value => createHash('sha256').update(value).digest('hex');

export function settings(root) {
  try {
    const value = JSON.parse(readFileSync(join(root, '.omp/efficiency.json'), 'utf8'));
    if (![1, 2].includes(value.version) || typeof value.enabled !== 'boolean' ||
        (value.version === 2 && (!value.skills || FAMILIES.some(name => typeof value.skills[name] !== 'boolean') ||
          Object.keys(value.skills).some(name => !FAMILIES.includes(name))))) {
      throw new Error('Invalid efficiency settings');
    }
    return { ...defaults(), ...value, version: 2, skills: { ...DEFAULTS.skills, ...value.skills } };
  } catch (error) {
    if (error.code === 'ENOENT') return defaults();
    // Bad optimization config must never disable, replace or block the mission's gates.
    return { ...defaults(), enabled: false, error: 'Invalid efficiency settings; optimization bypassed.' };
  }
}

export function saveJson(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
}

export function setEnabled(root, enabled, family) {
  if (family && family !== 'all' && !FAMILIES.includes(family)) throw new Error('Unknown skill family');
  const current = settings(root);
  const next = { ...current, version: 2, skills: { ...current.skills } };
  if (!family || family === 'all') {
    next.enabled = enabled;
    if (family === 'all') for (const name of FAMILIES) next.skills[name] = enabled;
  } else {
    next.skills[family] = enabled;
    if (enabled) next.enabled = true;
  }
  delete next.error;
  saveJson(join(root, '.omp/efficiency.json'), next);
  syncSkillAdapters(root, next);
  return next;
}

function suiteManifest(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, '.omp/upstream-suite.json'), 'utf8'));
    if (manifest.version !== 1 || !manifest.families) throw new Error('Invalid suite manifest');
    return manifest;
  } catch (error) {
    return { families: {}, error: error.code === 'ENOENT' ? 'sources_not_prepared' : 'invalid_suite_manifest' };
  }
}

function originalSources(root, name, family) {
  if (!family?.sources || !Object.keys(family.sources).length) throw new Error('sources_not_prepared');
  const prefix = '.omp/vendor/efficiency/packages/' + name + '/';
  const base = realpathSync(join(root, prefix));
  return Object.entries(family.sources).map(([path, expected]) => {
    if (!path.startsWith(prefix) || path.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(expected)) {
      throw new Error('invalid_source_boundary');
    }
    const absolute = realpathSync(resolve(root, path));
    if (!absolute.startsWith(base + sep)) throw new Error('invalid_source_boundary');
    const bytes = readFileSync(absolute);
    if (digest(bytes) !== expected) throw new Error('source_integrity_mismatch');
    return { path, text: bytes.toString('utf8'), sha256: expected };
  });
}

export function suiteStatus(root, config = settings(root)) {
  const manifest = suiteManifest(root);
  return Object.fromEntries(FAMILIES.map(name => {
    const family = manifest.families[name];
    const enabled = config.enabled && config.skills[name];
    let integrity = 'verified';
    try { originalSources(root, name, family); } catch (error) { integrity = error.message; }
    const admission = family?.admission;
    const status = !enabled ? 'disabled' : integrity !== 'verified' ? 'blocked_' + integrity :
      admission === 'ready' ? 'ready_native_guidance' :
        admission === 'blocked_provider_conformance' ? 'blocked_provider_conformance' : 'blocked_unknown_admission';
    return [name, { enabled, status, integrity, commit: family?.commit ?? null,
      controller: name === 'autoprompt' ? 'not_admitted; original OMP provider registry declared-unverified' : 'existing_OMP_owner',
      adapter: '.omp/vendor/efficiency/active-skills/upstream-' + name + '/SKILL.md' }];
  }));
}

export function syncSkillAdapters(root, config = settings(root)) {
  const manifest = suiteManifest(root);
  const status = suiteStatus(root, config);
  for (const name of FAMILIES) {
    const row = status[name], family = manifest.families[name];
    const dir = join(root, '.omp/vendor/efficiency/active-skills/upstream-' + name);
    const path = join(dir, 'SKILL.md');
    if (!family || (row.status !== 'ready_native_guidance' &&
        !(name === 'autoprompt' && row.status === 'blocked_provider_conformance'))) {
      try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      continue;
    }
    const blocked = row.status === 'blocked_provider_conformance';
    const sources = Object.entries(family.sources).map(([source, hash]) => `- \`${source}\` (sha256 ${hash})`).join('\n');
    const text = `---\nname: upstream-${name}\ndescription: ${blocked ? 'BLOCKED controller; inspect ' : ''}${family.description}\n---\n\n` +
      `Native adapter for original ${name} at ${family.commit}; upstream files are unchanged.\n\n` +
      `Read docs/OMP_UPSTREAM_SKILLS_COMPATIBILITY_TH.md once per session before the original instructions. ` +
      `Run .omp/eff skills to verify this family is enabled and its sources match. Read only the source relevant to the current task:\n\n${sources}\n\n` +
      (blocked ? `The full Autoprompt controller is BLOCKED: the original OMP provider registry is declared-unverified with no current attestation. ` +
        `Inspect original instructions/contracts only. Do not launch a controller, claim full v2 enforcement, or replace the saved OMP goal. Continue ready BitPOS work with the other enabled families.\n` :
        `Use native OMP tools and existing plan/checkpoint/gates. Read docs/OMP_EXECUTION_POLICY_TH.md for current model routing, disjoint-file leases and proportional batch/risk review. Latest human permissions and current goal remain binding.\n`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, text);
  }
  return status;
}

export function skillText(root, name) {
  if (!FAMILIES.includes(name)) throw new Error('Unknown skill family');
  const status = suiteStatus(root)[name];
  if (status.status !== 'ready_native_guidance') throw new Error(`${name}: ${status.status}`);
  const family = suiteManifest(root).families[name];
  const source = originalSources(root, name, family)[0];
  return `Original upstream ${name}; source ${source.path}; sha256 ${source.sha256}. ` +
    `Apply the native compatibility contract in docs/OMP_UPSTREAM_SKILLS_COMPATIBILITY_TH.md.\n\n${source.text}`;
}

export function skillPolicy(root) {
  const config = settings(root);
  const status = suiteStatus(root, config);
  if (!config.enabled) return 'BITPOS_UPSTREAM_SUITE: OFF. Do not activate upstream skill workflows; original project permissions, goal and gates remain binding.';
  const ready = FAMILIES.filter(name => status[name].status === 'ready_native_guidance');
  const blocked = FAMILIES.filter(name => status[name].enabled && !ready.includes(name));
  return 'BITPOS_UPSTREAM_SUITE: ON. Native guidance available: ' + ready.join(', ') + '. ' +
    'Load only guidance needed for the current task; no mandatory all-family read or per-function skill/arena/scout chain. ' +
    'Read matching SKILL.md and relevant original source once as needed, not again after every resumed batch; do not inline whole suites. ' +
    'Compatibility: docs/OMP_UPSTREAM_SKILLS_COMPATIBILITY_TH.md. Continue from docs/CHECKPOINT.md and current work package; never replace the saved goal or redo verified slices. ' +
    'Blocked families: ' + (blocked.map(name => name + '=' + status[name].status).join(', ') || 'none') + '. ' +
    'Never start unadmitted controllers, duplicate writers/reviewers or bypass financial/auth/quota gates.';
}

/** Retrieval aid, never an acceptance ledger. Older entries remain in the source. */
export function checkpointPacket(root, config = settings(root), maxChars = 12000) {
  const path = join(root, 'docs/CHECKPOINT.md');
  const full = readFileSync(path, 'utf8');
  if (!config.enabled || full.length <= maxChars) return full;
  const sections = [...full.matchAll(/^## .+$/gm)].map(match => match.index);
  let start = sections.find(index => full.length - index <= maxChars);
  // Never cut a section or silently omit a large newest entry.
  if (start === undefined) start = sections.at(-1) ?? 0;
  return `CHECKPOINT RETRIEVAL PACKET (not complete scope or proof of completion)\n` +
    `Source: ${path}\nsha256: ${digest(full)}\n` +
    `Showing latest complete sections; ${start} earlier characters omitted.\n` +
    `Search/read the full source for the relevant scope, requirements and blockers.\n\n` + full.slice(start);
}

export function runtimeReceipt(root, data) {
  const dir = join(root, '.omp/work/efficiency');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  saveJson(join(dir, 'runtime.json'), data);
}
