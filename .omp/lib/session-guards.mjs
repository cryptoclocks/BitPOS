import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync, renameSync, rmSync, openSync, closeSync, linkSync, unlinkSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const SHA = /^[a-f0-9]{64}$/;
const LABEL = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
function requireValue(condition, code) { if (!condition) throw Error(code); }
function contained(base, path) { return path === base || path.startsWith(base + sep); }

// Never accept session dumps, private keys or paths outside the checkout as proof inputs.
export function proofFile(root, path) {
  const base = realpathSync(root), absolute = realpathSync(resolve(base, path));
  requireValue(contained(base, absolute), 'PROOF_OUTSIDE_CHECKOUT');
  const name = relative(base, absolute).split(sep).join('/');
  requireValue(/^(apps|packages|tools|tests|docs|design\/figcraft\/(handoff|previews)|\.omp\/(lib|tests|loop|work))\//.test(name) || /^\.omp\/(guard|pace)(\.mjs)?$/.test(name), 'PROOF_PATH_NOT_ALLOWED');
  requireValue(!/(^|\/)(sessions?|private|secrets?|wallets?|node_modules|\.git)(\/|$)|(^|\/)\.env(?:\.|$)|(?:credentials|access[-_]?token|refresh[-_]?token|private[-_]?key)/i.test(name), 'PRIVATE_PROOF_PATH');
  const stat = statSync(absolute);
  requireValue(stat.isFile() && stat.size <= 64 * 1024 * 1024, 'PROOF_NOT_BOUNDED_FILE');
  return { absolute, name, stat };
}
function workDirectory(root, scope, kind) {
  requireValue(LABEL.test(scope), 'INVALID_SCOPE');
  const base = realpathSync(root);
  let path = base;
  for (const part of ['.omp', 'work', scope, kind]) {
    path = join(path, part);
    try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    requireValue(contained(base, realpathSync(path)), 'WORK_DIRECTORY_OUTSIDE_CHECKOUT');
    requireValue(statSync(path).isDirectory(), 'WORK_PATH_NOT_DIRECTORY');
  }
  return path;
}
export function captureDirectory(root, scope, label) {
  requireValue(LABEL.test(label), 'INVALID_LABEL');
  return mkdtempSync(join(workDirectory(root, scope, 'evidence'), label + '-'));
}
export function sourceBindings(root, paths) {
  requireValue(Array.isArray(paths) && paths.length > 0 && paths.length <= 200, 'INVALID_PROOF_FILES');
  const files = {};
  for (const path of paths) {
    requireValue(typeof path === 'string', 'INVALID_PROOF_PATH');
    const file = proofFile(root, path);
    requireValue(!Object.hasOwn(files, file.name), 'DUPLICATE_PROOF_FILE');
    files[file.name] = hash(readFileSync(file.absolute));
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
// Write completely, then atomically publish without replacing an existing path.
function exclusiveJson(path, value) {
  const temp = path + '.' + process.pid + '.tmp';
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); }
  finally { closeSync(fd); }
  try { linkSync(temp, path); } finally { unlinkSync(temp); }
}
export function sealEvidence(root, scope, label, paths) {
  const files = sourceBindings(root, paths);
  const directory = captureDirectory(root, scope, label), path = join(directory, 'manifest.json');
  const manifest = { version: 1, purpose: 'binding_only_not_acceptance', scope,
    recordedAt: new Date().toISOString(), files, fingerprint: hash(JSON.stringify(files)) };
  exclusiveJson(path, manifest);
  return { path: relative(realpathSync(root), path), manifestSha256: hash(readFileSync(path)), ...manifest };
}
export function verifyEvidence(root, path) {
  const file = proofFile(root, path), manifest = JSON.parse(readFileSync(file.absolute, 'utf8'));
  requireValue(manifest.version === 1 && manifest.purpose === 'binding_only_not_acceptance' && LABEL.test(manifest.scope), 'INVALID_MANIFEST');
  requireValue(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'INVALID_MANIFEST_FILES');
  const paths = Object.keys(manifest.files);
  requireValue(paths.length > 0 && paths.length <= 200, 'INVALID_MANIFEST_FILES');
  const errors = [];
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (typeof expected !== 'string' || !SHA.test(expected)) { errors.push({ path: name, code: 'INVALID_SHA256' }); continue; }
    try {
      const actual = proofFile(root, name);
      if (actual.name !== name) errors.push({ path: name, code: 'NON_CANONICAL_PATH' });
      else if (hash(readFileSync(actual.absolute)) !== expected) errors.push({ path: name, code: 'SOURCE_CHANGED' });
    } catch { errors.push({ path: name, code: 'PROOF_UNAVAILABLE' }); }
  }
  const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
  if (!SHA.test(manifest.fingerprint) || manifest.fingerprint !== hash(JSON.stringify(sorted))) errors.push({ code: 'MANIFEST_FINGERPRINT_MISMATCH' });
  return { ok: errors.length === 0, purpose: 'binding_only_not_acceptance', errors, filesChecked: paths.length };
}

function runText(binary, args) {
  return execFileSync(binary, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 }).trim();
}
export function observeRuntime(root, runtime) {
  requireValue(Number.isSafeInteger(runtime.pid) && runtime.pid > 1, 'INVALID_RUNTIME_PID');
  const expected = runtime.entry;
  requireValue(expected === 'tools/runtime/delivery-fixture-server.ts', 'ONLY_LOCAL_FIXTURE_RUNTIME_ALLOWED');
  const command = runText('/bin/ps', ['-p', String(runtime.pid), '-o', 'command=']);
  const cwd = runText('/usr/sbin/lsof', ['-a', '-p', String(runtime.pid), '-d', 'cwd', '-Fn']).split('\n').find(line => line.startsWith('n'))?.slice(1);
  const started = runText('/bin/ps', ['-p', String(runtime.pid), '-o', 'lstart=']);
  return { owned: cwd === realpathSync(root) && command.split(/\s+/).some(arg => arg === expected || arg === join(realpathSync(root), expected)),
    startedAt: Date.parse(started) };
}
export function observeSchema(fixture) {
  requireValue(fixture.host === '127.0.0.1' && fixture.port === 55446 && fixture.database === 'bitpos_w01_fixture', 'ONLY_DISPOSABLE_LOCAL_SCHEMA_ALLOWED');
  // Fixed SELECT only; no environment DSN, arbitrary SQL, migrations or service restart.
  const sql = `SELECT json_build_object('database',current_database(),
    'columns',(SELECT coalesce(json_agg(table_name||'.'||column_name),'[]'::json) FROM information_schema.columns WHERE table_schema='bitpos'),
    'constraints',(SELECT coalesce(json_agg(c.conname),'[]'::json) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='bitpos'),
    'triggers',(SELECT coalesce(json_agg(t.tgname),'[]'::json) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bitpos' AND NOT t.tgisinternal))`;
  return JSON.parse(runText('/opt/homebrew/opt/postgresql@17/bin/psql', ['-X', '-w', '-h', '127.0.0.1', '-p', '55446', '-d', 'bitpos_w01_fixture', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]));
}
export function readiness(root, plan, { runtimeProbe = observeRuntime, schemaProbe = observeSchema, clock = Date.now } = {}) {
  requireValue(plan.version === 1 && (plan.runtime || plan.fixture || plan.acceptance), 'INVALID_PREFLIGHT_PLAN');
  const errors = [], checked = [];
  if (plan.runtime) {
    const runtime = plan.runtime;
    sourceBindings(root, runtime.sourceFiles); // Validate/bound inputs before the probe.
    try {
      const observation = runtimeProbe(root, runtime);
      if (!observation.owned) errors.push('RUNTIME_OWNER_MISMATCH');
      if (!Number.isFinite(observation.startedAt) || observation.startedAt > clock()) errors.push('RUNTIME_START_UNKNOWN');
      else for (const path of runtime.sourceFiles) {
        if (proofFile(root, path).stat.mtimeMs > observation.startedAt) errors.push('RUNTIME_SOURCE_NEWER_THAN_PROCESS:' + proofFile(root, path).name);
      }
    } catch { errors.push('RUNTIME_UNAVAILABLE'); }
    checked.push('runtime_identity_and_conservative_source_freshness');
  }
  if (plan.fixture) {
    const fixture = plan.fixture;
    requireValue(fixture.host === '127.0.0.1' && fixture.port === 55446 && fixture.database === 'bitpos_w01_fixture', 'ONLY_DISPOSABLE_LOCAL_SCHEMA_ALLOWED');
    for (const key of ['columns', 'constraints', 'triggers']) requireValue(Array.isArray(fixture[key]) && fixture[key].length <= 100 && fixture[key].every(x => typeof x === 'string' && /^[a-z_][a-z_0-9.]{0,140}$/.test(x)), 'INVALID_SCHEMA_REQUIREMENTS');
    requireValue(fixture.columns.length + fixture.constraints.length + fixture.triggers.length > 0, 'EMPTY_SCHEMA_REQUIREMENTS');
    try {
      const observed = schemaProbe(fixture);
      if (observed.database !== fixture.database) errors.push('DATABASE_IDENTITY_MISMATCH');
      for (const key of ['columns', 'constraints', 'triggers']) for (const name of fixture[key]) {
        if (!Array.isArray(observed[key]) || !observed[key].includes(name)) errors.push('SCHEMA_MISSING:' + key + ':' + name);
      }
    } catch { errors.push('SCHEMA_UNAVAILABLE'); }
    checked.push('required_local_schema_objects');
  }
  if (plan.acceptance) {
    const acceptance = plan.acceptance;
    requireValue(Number.isFinite(acceptance.minimumRemainingSeconds) && acceptance.minimumRemainingSeconds >= 0, 'INVALID_DEADLINE_BUDGET');
    const deadline = Date.parse(acceptance.deadline);
    // Read at the decision boundary: synchronous process/schema probes can consume
    // most of a short acceptance window. Entry-time timestamps must not admit it.
    const decisionAt = clock();
    if (!Number.isFinite(deadline)) errors.push('ACCEPTANCE_DEADLINE_UNKNOWN');
    else if (!Number.isFinite(decisionAt)) errors.push('ACCEPTANCE_CLOCK_UNKNOWN');
    else if (deadline - decisionAt < acceptance.minimumRemainingSeconds * 1000) errors.push('ACCEPTANCE_BUDGET_EXHAUSTED');
    if (acceptance.merchantReady !== true) errors.push('MERCHANT_NOT_READY');
    checked.push('deadline_budget_and_declared_merchant_readiness');
  }
  return { ok: errors.length === 0, purpose: 'local_readiness_only_not_e2e', checked, errors };
}

function diagnosisBinding(root, path) {
  if (!path) return null;
  const file = proofFile(root, path), data = JSON.parse(readFileSync(file.absolute, 'utf8'));
  requireValue(data.version === 1 && typeof data.hypothesis === 'string' && data.hypothesis.trim().length >= 12 && typeof data.change === 'string' && data.change.trim().length >= 12, 'DIAGNOSIS_REQUIRES_HYPOTHESIS_AND_CHANGE');
  const observation = proofFile(root, data.observation.path);
  requireValue(SHA.test(data.observation.sha256) && hash(readFileSync(observation.absolute)) === data.observation.sha256, 'DIAGNOSIS_OBSERVATION_STALE');
  return hash(JSON.stringify({ hypothesis: data.hypothesis.trim(), change: data.change.trim(), observation: { path: observation.name, sha256: data.observation.sha256 } }));
}
export function guardedRun(root, { scope, step, diagnosis, command }, execute = (binary, args) => spawnSync(binary, args, { cwd: root, stdio: 'inherit', shell: false })) {
  requireValue(LABEL.test(step) && Array.isArray(command) && command.length > 0 && command.every(x => typeof x === 'string') && command[0].length > 0, 'INVALID_GUARDED_COMMAND');
  const directory = workDirectory(root, scope, 'guard-state'), path = join(directory, step + '.json'), lock = path + '.lock';
  try { mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') throw Error('STEP_ALREADY_RUNNING_OR_LOCK_REQUIRES_OWNER_RECONCILIATION'); throw error; }
  try {
    let state;
    try { state = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw Error('INVALID_ATTEMPT_STATE'); state = { version: 1, failures: 0, usedDiagnoses: [], attempts: [] }; }
    requireValue(state.version === 1 && Number.isSafeInteger(state.failures) && state.failures >= 0 && Array.isArray(state.usedDiagnoses) && Array.isArray(state.attempts), 'INVALID_ATTEMPT_STATE');
    requireValue(state.attempts.at(-1)?.status !== 'running', 'PREVIOUS_ATTEMPT_REQUIRES_OWNER_RECONCILIATION');
    const diagnosed = state.failures >= 2 ? diagnosisBinding(root, diagnosis) : null;
    if (state.failures >= 2) requireValue(diagnosed && !state.usedDiagnoses.includes(diagnosed), 'RETRY_REQUIRES_NEW_OBSERVATION_HYPOTHESIS_AND_CHANGE');
    if (diagnosed) state.usedDiagnoses.push(diagnosed);
    const startedAt = new Date().toISOString();
    // Persist admission before running: a crashed wrapper must not lose the consumed diagnosis.
    const pending = { startedAt, commandSha256: hash(JSON.stringify(command)), diagnosisSha256: diagnosed, status: 'running' };
    state.attempts.push(pending);
    const save = () => { const temp = path + '.' + process.pid + '.tmp'; writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 }); renameSync(temp, path); };
    save();
    let result;
    try { result = execute(command[0], command.slice(1)); }
    catch { result = { status: null }; }
    const passed = result.status === 0;
    pending.status = passed ? 'pass' : 'fail'; pending.finishedAt = new Date().toISOString();
    state.failures = passed ? 0 : state.failures + 1;
    save();
    return { ok: passed, exitCode: Number.isInteger(result.status) && result.status >= 0 ? result.status : 1,
      consecutiveFailures: state.failures, nextAttemptNeedsDiagnosis: state.failures >= 2,
      state: relative(realpathSync(root), path) };
  } finally { rmSync(lock, { recursive: true }); }
}
