// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Exercises the deployed bills contract on NEAR testnet with real transactions and writes the
// transaction links to near-hackathon/evidence/. Usage: tsx tools/near/e2e-chain.ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { payMessage, realChain, witnessMessage, type TxView } from '../../apps/api/src/near/chain.ts';
import { EXPLORER_TX, PRIVATE_DIR, RPC_URLS, sleep } from './lib.ts';

const deployment = JSON.parse(fs.readFileSync('near-hackathon/near-deployment.json', 'utf8'));
const chain = realChain({ network: 'testnet', rpcUrls: RPC_URLS, billsContract: deployment.bills_contract, relayerAccount: deployment.relayer, privateDir: PRIVATE_DIR, explorerTx: EXPLORER_TX });
const shop: string = deployment.demo_shop.account, token: string = deployment.tokens.tUSD.contract, alice: string = deployment.demo_customers[0];
const recipients = [
  { account: shop, amount: 3_550_000n, role: 'owner' },
  { account: deployment.demo_shop.staff[0], amount: 500_000n, role: 'tips' },
  { account: deployment.demo_shop.tax, amount: 350_000n, role: 'tax' },
  { account: deployment.demo_shop.supplier, amount: 600_000n, role: 'supplier' },
];
const TOTAL = 5_000_000n;
const run = crypto.randomBytes(4).toString('hex');
const steps: { case: string; step: string; tx: string; ok: boolean; events: string[] }[] = [];
const record = (name: string, step: string, tx: TxView) => { steps.push({ case: name, step, tx: EXPLORER_TX + tx.hash, ok: tx.ok, events: tx.events.map(event => `${event.standard}:${event.event}`) }); console.log(name, step, tx.ok ? 'ok' : 'FAILED', tx.final ? 'FINAL' : 'not final', tx.events.map(event => event.event).join(','), EXPLORER_TX + tx.hash); return tx; };
const balances = async () => Object.fromEntries(await Promise.all([alice, deployment.bills_contract, ...recipients.map(recipient => recipient.account)].map(async id => [id, await chain.ftBalance(token, id)]))) as Record<string, bigint>;
const open = (billId: string, witnessPk: string | null, witnessTimeoutMs = 120_000) => chain.openBill(shop, { billId, token, total: TOTAL, payouts: recipients, expiresAtMs: Date.now() + 300_000, witnessPk, witnessTimeoutMs });
const pay = async (billId: string, amount: bigint) => chain.relay(await chain.signDemoPayment(alice, token, amount, payMessage(shop, billId)));
const state = async (billId: string) => (await chain.getBill(shop, billId))?.state;

// A. exact gasless payment, no witness: one batch pays four recipients
{
  const id = `e2e-${run}-a`, before = await balances();
  record('A', 'open_bill', await open(id, null));
  const paid = record('A', 'pay (gasless, relayed)', await pay(id, TOTAL));
  assert(paid.ok && paid.final);
  assert.equal(await state(id), 'Settled');
  const after = await balances();
  assert.equal(before[alice] - after[alice], TOTAL);
  for (const recipient of recipients) assert.equal(after[recipient.account] - before[recipient.account], recipient.amount, recipient.role);
  assert.equal(after[deployment.bills_contract], before[deployment.bills_contract]);
}
// B. wrong amount bounces back by itself
{
  const id = `e2e-${run}-b`, before = await balances();
  record('B', 'open_bill', await open(id, null));
  const paid = record('B', 'pay 1 unit short', await pay(id, TOTAL - 1n));
  assert(paid.events.some(event => event.event === 'payment_bounced' && event.data.reason === 'WRONG_AMOUNT'));
  assert.equal(await state(id), 'Open');
  assert.deepEqual(await balances(), before);
  record('B', 'void_bill', await chain.voidBill(shop, id));
  const late = record('B', 'pay a voided bill', await pay(id, TOTAL));
  assert(late.events.some(event => event.event === 'payment_bounced' && event.data.reason === 'BILL_NOT_OPEN'));
  assert.deepEqual(await balances(), before);
}
// C. witness escrow: a forged signature is refused, the device's signature releases the split
{
  const id = `e2e-${run}-c`, before = await balances();
  const deviceKey = ed25519.utils.randomPrivateKey(), devicePk = Buffer.from(ed25519.getPublicKey(deviceKey)).toString('hex');
  record('C', 'open_bill with witness', await open(id, devicePk));
  record('C', 'pay', await pay(id, TOTAL));
  assert.equal(await state(id), 'Escrow');
  assert.equal((await balances())[deployment.bills_contract] - before[deployment.bills_contract], TOTAL);
  const message = Buffer.from(witnessMessage(deployment.bills_contract, shop, id));
  const forged = Buffer.from(ed25519.sign(message, ed25519.utils.randomPrivateKey())).toString('hex');
  const refused = await chain.deviceAck(shop, id, forged).then(tx => record('C', 'forged device_ack', tx), error => { console.log('C forged device_ack rejected:', String(error?.message ?? error).slice(0, 120)); return null; });
  assert(!refused || !refused.ok);
  assert.equal(await state(id), 'Escrow');
  record('C', 'device_ack', await chain.deviceAck(shop, id, Buffer.from(ed25519.sign(message, deviceKey)).toString('hex')));
  assert.equal(await state(id), 'Settled');
  const after = await balances();
  for (const recipient of recipients) assert.equal(after[recipient.account] - before[recipient.account], recipient.amount, recipient.role);
}
// D. no witness: after the timeout anyone can send the money back to the payer
{
  const id = `e2e-${run}-d`, before = await balances();
  const devicePk = Buffer.from(ed25519.getPublicKey(ed25519.utils.randomPrivateKey())).toString('hex');
  record('D', 'open_bill with witness (30 s)', await open(id, devicePk, 30_000));
  record('D', 'pay', await pay(id, TOTAL));
  assert.equal(await state(id), 'Escrow');
  const early = await chain.reclaim(shop, id).then(tx => record('D', 'reclaim too early', tx), () => null);
  assert(!early || !early.ok);
  await sleep(36_000);
  record('D', 'reclaim after timeout', await chain.reclaim(shop, id));
  assert.equal(await state(id), 'Refunded');
  assert.deepEqual(await balances(), before);
}
const file = `near-hackathon/evidence/e2e-chain-${new Date().toISOString().slice(0, 10)}-${run}.json`;
fs.writeFileSync(file, JSON.stringify({ network: 'testnet', contract: deployment.bills_contract, token, ran_at: new Date().toISOString(), result: 'all assertions passed', steps }, null, 2) + '\n');
console.log('ALL PASSED · wrote', file);
