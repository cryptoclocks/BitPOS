// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// One-time, re-runnable testnet setup: deploy the bills contract and the tUSD test token,
// register the demo shop, its recipients and the demo customers. Writes public ids to
// near-hackathon/near-deployment.json. Usage: tsx tools/near/setup.ts [--redeploy]
import crypto from 'node:crypto';
import fs from 'node:fs';
import { KeyPair, actions, nearToYocto, teraToGas } from 'near-api-js';
import { EXPLORER_TX, account, ensureSubAccount, hasKey, loadPublicKey, provider, saveKey, view } from './lib.ts';

const ROOT = process.env.NEAR_ROOT ?? 'bitpos-near.testnet';
const BILLS = `bills.${ROOT}`, TUSD = `tusd.${ROOT}`, RELAYER = `relayer.${ROOT}`, SHOP = `orbit.${ROOT}`;
const CIRCLE_USDC = '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af';
const GLOBAL_FT = 'ft.globals.primitives.testnet';
const RECIPIENTS = [BILLS, SHOP, `tax.${SHOP}`, `mai.${SHOP}`, `ton.${SHOP}`, `milkfarm.${ROOT}`, `alice.${ROOT}`, `bob.${ROOT}`, RELAYER];
// A fresh local build wins; otherwise the committed release build (same bytes as deployed, see wasm_sha256).
const WASM = fs.existsSync('contracts/near-bills/target/near/near_bills.wasm') ? 'contracts/near-bills/target/near/near_bills.wasm' : 'contracts/near-bills/release/near_bills.wasm';
const redeploy = process.argv.includes('--redeploy');
const txs: Record<string, string> = {};
const note = (label: string, result: { transaction: { hash: string } }) => { txs[label] = result.transaction.hash; console.log(label, EXPLORER_TX + result.transaction.hash); };
const gas = teraToGas('100');

// 0. sub-accounts (about 6.5 NEAR of the faucet's 10 in total; skipped when they exist)
for (const [name, near] of [[BILLS, '3.5'], [TUSD, '0.3'], [RELAYER, '1.5'], [SHOP, '0.6'], [`milkfarm.${ROOT}`, '0.05'], [`alice.${ROOT}`, '0.1'], [`bob.${ROOT}`, '0.1'], [`tax.${SHOP}`, '0.05'], [`mai.${SHOP}`, '0.05'], [`ton.${SHOP}`, '0.05'], [`agent.${ROOT}`, '0.3']] as const)
  if (await ensureSubAccount(name, near)) console.log('created', name);
const root = account(ROOT);
const wasm = fs.readFileSync(WASM);

// 1. bills contract
const initialised = await view(BILLS, 'get_config').then(() => true, () => false);
if (redeploy || !initialised) note('bills_deploy', await account(BILLS).signAndSendTransaction({ receiverId: BILLS, waitUntil: 'FINAL', actions: [actions.deployContract(wasm), ...(initialised ? [] : [actions.functionCall('new', { owner: ROOT }, gas, 0n)])] }));
// 2. tUSD test token (global FT contract, fixed supply held by the token account as the demo bank)
if (!(await view(TUSD, 'ft_metadata').then(() => true, () => false))) {
  note('tusd_deploy', await account(TUSD).signAndSendTransaction({ receiverId: TUSD, waitUntil: 'FINAL', actions: [
    actions.useGlobalContract({ accountId: GLOBAL_FT }),
    actions.functionCall('new', { owner_id: TUSD, total_supply: '1000000000000', metadata: { spec: 'ft-1.0.0', name: 'BitPOS Test USD', symbol: 'tUSD', decimals: 6 } }, gas, 0n),
  ] }));
}
// 3. allow-list
for (const token of [TUSD, CIRCLE_USDC]) if (!(await view<boolean>(BILLS, 'is_token_allowed', { token }))) note(`set_token_${token.slice(0, 8)}`, await root.callFunctionRaw({ contractId: BILLS, methodName: 'set_token', args: { token, allowed: true }, gas, waitUntil: 'FINAL' }));
if (!(await view<boolean>(BILLS, 'is_merchant_active', { merchant: SHOP }))) note('set_merchant', await root.callFunctionRaw({ contractId: BILLS, methodName: 'set_merchant', args: { merchant: SHOP, active: true }, gas, waitUntil: 'FINAL' }));
// 4. token storage for everyone who will hold tUSD (and the contract on Circle USDC)
for (const token of [TUSD, CIRCLE_USDC]) for (const id of token === TUSD ? RECIPIENTS : [BILLS]) {
  if (await view(token, 'storage_balance_of', { account_id: id })) continue;
  note(`storage_${token.slice(0, 4)}_${id.split('.')[0]}`, await root.callFunctionRaw({ contractId: token, methodName: 'storage_deposit', args: { account_id: id, registration_only: true }, gas: teraToGas('30'), deposit: nearToYocto('0.00125'), waitUntil: 'FINAL' }));
}
// 5. demo customers get tUSD
for (const id of [`alice.${ROOT}`, `bob.${ROOT}`]) {
  if (BigInt(await view<string>(TUSD, 'ft_balance_of', { account_id: id })) >= 100_000_000n) continue;
  note(`fund_${id.split('.')[0]}`, await account(TUSD).callFunctionRaw({ contractId: TUSD, methodName: 'ft_transfer', args: { receiver_id: id, amount: '500000000', memo: 'demo funds' }, gas: teraToGas('30'), deposit: 1n, waitUntil: 'FINAL' }));
}
// 6. cashier key: the only key the POS server holds for the shop. It can open, void and refund bills. It cannot move the shop's money.
if (!hasKey(SHOP, 'cashier')) {
  const keyPair = KeyPair.fromRandom('ed25519');
  note('cashier_key', await account(SHOP).addFunctionCallAccessKey({ publicKey: keyPair.getPublicKey(), contractId: BILLS, methodNames: ['open_bill', 'void_bill', 'merchant_refund'], allowance: nearToYocto('0.25') }));
  saveKey(SHOP, keyPair, 'cashier');
}

// 7. AI agent key for spending passes: it can call `pass_pay` on the bills contract and nothing else.
// The agent never holds the guest's money; the pass does, inside the bills contract.
const AGENT = `agent.${ROOT}`;
if (!hasKey(AGENT, 'pass')) {
  const keyPair = KeyPair.fromRandom('ed25519');
  note('agent_pass_key', await account(AGENT).addFunctionCallAccessKey({ publicKey: keyPair.getPublicKey(), contractId: BILLS, methodNames: ['pass_pay'], allowance: nearToYocto('0.25') }));
  saveKey(AGENT, keyPair, 'pass');
}

const out = {
  network: 'testnet', root: ROOT, bills_contract: BILLS, tokens: { tUSD: { contract: TUSD, decimals: 6 }, USDC: { contract: CIRCLE_USDC, decimals: 6, note: 'Circle testnet USDC; get it from faucet.circle.com' } },
  relayer: RELAYER, demo_shop: { account: SHOP, cashier_public_key: loadPublicKey(SHOP, 'cashier'), tax: `tax.${SHOP}`, staff: [`mai.${SHOP}`, `ton.${SHOP}`], supplier: `milkfarm.${ROOT}` },
  ai_agent: { account: AGENT, pass_key_public: loadPublicKey(AGENT, 'pass'), methods: ['pass_pay'] },
  demo_customers: [`alice.${ROOT}`, `bob.${ROOT}`], wasm_sha256: crypto.createHash('sha256').update(wasm).digest('hex'),
  config: await view(BILLS, 'get_config'),
};
const file = 'near-hackathon/near-deployment.json';
const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
fs.writeFileSync(file, JSON.stringify({ ...out, setup_transactions: { ...(previous.setup_transactions ?? {}), ...txs } }, null, 2) + '\n');
console.log('wrote', file);
