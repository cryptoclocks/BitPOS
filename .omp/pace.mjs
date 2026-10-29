import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executionSettings, setExecution, executionPolicy, ROUTES } from './lib/execution.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [op = 'status', role, ...extra] = process.argv.slice(2);
if (extra.length || !['on', 'off', 'status', 'brief', 'route'].includes(op) ||
    (op === 'route' ? !Object.hasOwn(ROUTES, role) : role !== undefined)) {
  console.error('Usage: .omp/pace on|off|status|brief|route <role>'); process.exitCode = 2;
} else if (op === 'route') console.log(ROUTES[role]);
else if (op === 'brief') console.log(executionPolicy(root));
else console.log(JSON.stringify({ settings: ['on', 'off'].includes(op) ? setExecution(root, op === 'on') : executionSettings(root),
  routes: ROUTES, activation: 'Persisted policy. A live owner must read this policy and dispatch explicit model selectors; configuration files alone are not runtime proof.',
  gates: 'Financial/auth/goal/quota/final-acceptance unchanged; OFF disables batching advice, not model authorization.' }, null, 2));
