#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureDirectory, sealEvidence, verifyEvidence, readiness, guardedRun, proofFile } from './lib/session-guards.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const usage = 'Usage: .omp/guard dir|seal --scope NAME --label NAME [--file PATH ...] | verify --manifest PATH | preflight --plan PATH | run --scope NAME --step NAME [--diagnosis PATH] -- COMMAND ARG...';
try {
  const [op, ...args] = process.argv.slice(2), flags = {}, files = [];
  const split = args.indexOf('--'), options = split < 0 ? args : args.slice(0, split), command = split < 0 ? [] : args.slice(split + 1);
  for (let i = 0; i < options.length; i += 2) {
    const key = options[i], value = options[i + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--')) throw Error(usage);
    if (key === '--file') files.push(value);
    else { if (Object.hasOwn(flags, key)) throw Error(usage); flags[key] = value; }
  }
  const keys = Object.keys(flags);
  const shape = (allowed, required, allowFiles = false, allowCommand = false) => {
    if (keys.some(k => !allowed.includes(k)) || required.some(k => !flags[k]) || (!allowFiles && files.length) || (!allowCommand && split >= 0)) throw Error(usage);
  };
  let result;
  if (op === 'dir' || op === 'seal') {
    shape(['--scope', '--label'], ['--scope', '--label'], op === 'seal');
    result = op === 'dir' ? { directory: relative(root, captureDirectory(root, flags['--scope'], flags['--label'])) } : sealEvidence(root, flags['--scope'], flags['--label'], files);
  } else if (op === 'verify') {
    shape(['--manifest'], ['--manifest']); result = verifyEvidence(root, flags['--manifest']);
  } else if (op === 'preflight') {
    shape(['--plan'], ['--plan']);
    const plan = JSON.parse(readFileSync(proofFile(root, flags['--plan']).absolute, 'utf8'));
    result = readiness(root, plan);
  } else if (op === 'run') {
    shape(['--scope', '--step', '--diagnosis'], ['--scope', '--step'], false, true);
    result = guardedRun(root, { scope: flags['--scope'], step: flags['--step'], diagnosis: flags['--diagnosis'], command });
    process.exitCode = result.exitCode;
  } else throw Error(usage);
  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false && !process.exitCode) process.exitCode = 1;
} catch (error) {
  // Files/commands may carry private data. Never dump arguments, file contents, SQL or stacks.
  const message = /^[A-Z_][A-Z_0-9:]*$/.test(error.message) || error.message === usage ? error.message : 'GUARD_INPUT_OR_IO_ERROR';
  console.error(JSON.stringify({ ok: false, error: message })); process.exitCode = 2;
}
