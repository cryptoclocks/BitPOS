// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// AI spending pass on NEAR testnet with real transactions: a customer funds a 1-hour pass for the AI agent,
// the agent pays a bill with its pass-only key, an unserved witness bill paid by the agent refunds the
// customer (not the agent), and closing the pass returns the unspent balance. Usage: tsx tools/near/e2e-pass.ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { passMessage, PASS_TTLS_MS, realChain, type TxView } from '../../apps/api/src/near/chain.ts';
import { EXPLORER_TX, PRIVATE_DIR, RPC_URLS, sleep } from './lib.ts';

const deployment = JSON.parse(fs.readFileSync('near-hackathon/near-deployment.json', 'utf8'));
const chain = realChain({ network: 'testnet', rpcUrls: RPC_URLS, billsContract: deployment.bills_contract, relayerAccount: deployment.relayer, privateDir: PRIVATE_DIR, explorerTx: EXPLORER_TX });
const shop: string = deployment.demo_shop.account, token: string = deployment.tokens.tUSD.contract, bob: string = deployment.demo_customers[1], agent: string = deployment.ai_agent.account;
const recipients = [
  { account: shop, amount: 3_550_000n, role: 'owner' },
  { account: deployment.demo_shop.staff[0], amount: 500_000n, role: 'tips' },
  { account: deployment.demo_shop.tax, amount: 350_000n, role: 'tax' },
  { account: deployment.demo_shop.supplier, amount: 600_000n, role: 'supplier' },
];
const TOTAL = 5_000_000n, CAP = 20_000_000n;
const run = crypto.randomBytes(4).toString('hex');
const passId = `pass-${run}`;
const steps: { step: string; tx: string; ok: boolean; events: string[] }[] = [];
const record = (step: string, tx: TxView) => { steps.push({ step, tx: EXPLORER_TX + tx.hash, ok: tx.ok, events: tx.events.map(e => `${e.standard}:${e.event}`) }); console.log(step, tx.ok ? 'ok' : 'FAILED ' + tx.failures.join(' '), tx.events.map(e => e.event).join(','), EXPLORER_TX + tx.hash); return tx; };
const open = (billId: string, witnessPk: string | null, witnessTimeoutMs = 120_000) => chain.openBill(shop, { billId, token, total: TOTAL, payouts: recipients, expiresAtMs: Date.now() + 300_000, witnessPk, witnessTimeoutMs });
const bal = (id: string) => chain.ftBalance(token, id);

// 1. bob funds a 1-hour pass for the agent, capped at 20 tUSD, 10 tUSD per bill, this café only (gasless for bob)
const bob0 = await bal(bob);
record('create pass (1 hour, cap 20, per bill 10, Orbit only)', await chain.relay(await chain.signDemoPayment(bob, token, CAP, passMessage({ passId, agent, ttlMs: PASS_TTLS_MS['1h'], maxBill: 10_000_000n, merchant: shop }))));
let pass = await chain.getPass(bob, passId);
assert(pass && pass.balance === CAP.toString() && pass.agent === agent);
assert.equal(bob0 - await bal(bob), CAP);

// 2. the agent pays an exact bill with its pass-only key: four payouts in the same receipt chain, bob is the payer
const a = `pass-${run}-a`;
record('open bill A', await open(a, null));
const paidA = record('agent pays bill A from the pass', await chain.passPay(agent, bob, passId, shop, a));
assert(paidA.ok && paidA.events.some(e => e.event === 'bill_settled'));
assert.equal((await chain.getBill(shop, a))?.state, 'Settled');
assert.equal((await chain.getBill(shop, a))?.payer, bob);
pass = await chain.getPass(bob, passId);
assert.equal(pass!.balance, (CAP - TOTAL).toString());

// 3. refund rule: a witness bill the table never confirms goes back to bob, not to the agent
const device = ed25519.utils.randomPrivateKey();
const b = `pass-${run}-b`;
record('open witness bill B (30 s window)', await open(b, Buffer.from(ed25519.getPublicKey(device)).toString('hex'), 30_000));
record('agent pays bill B from the pass', await chain.passPay(agent, bob, passId, shop, b));
assert.equal((await chain.getBill(shop, b))?.state, 'Escrow');
const bobBeforeRefund = await bal(bob);
await sleep(34_000);
record('not served in time: reclaim bill B', await chain.reclaim(shop, b));
assert.equal((await chain.getBill(shop, b))?.state, 'Refunded');
assert.equal(await bal(bob) - bobBeforeRefund, TOTAL, 'the refund went to the pass owner');

// 4. bob ends the pass early: the unspent balance comes back, and the agent can no longer spend
const bobBeforeClose = await bal(bob);
record('owner closes the pass', await chain.passClose(bob, bob, passId));
pass = await chain.getPass(bob, passId);
assert(pass!.closed && pass!.balance === '0');
assert.equal(await bal(bob) - bobBeforeClose, CAP - TOTAL - TOTAL);
const c = `pass-${run}-c`;
record('open bill C', await open(c, null));
const refused = await chain.passPay(agent, bob, passId, shop, c).catch(error => ({ refused: String((error as Error).message).match(/PASS_CLOSED|AGENT_ONLY|PASS_EXPIRED/)?.[0] ?? String(error).slice(0, 120) }));
console.log('agent after close:', JSON.stringify('refused' in refused ? refused : { ok: (refused as TxView).ok, failures: (refused as TxView).failures }));
assert('refused' in refused ? refused.refused === 'PASS_CLOSED' : !(refused as TxView).ok && (refused as TxView).failures.join(' ').includes('PASS_CLOSED'));
record('void bill C', await chain.voidBill(shop, c));

const out = { network: 'testnet', contract: deployment.bills_contract, agent, pass_owner: bob, pass_id: passId, ran_at: new Date().toISOString(), result: 'all assertions passed', agent_key: 'function-call key limited to pass_pay', steps };
const file = `near-hackathon/evidence/e2e-pass-${new Date().toISOString().slice(0, 10)}-${run}.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log('wrote', file);
