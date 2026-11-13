// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Creates the BitPOS NEAR testnet accounts. Private keys are written only to ~/.bitpos-near/testnet/keys (0600).
// Usage: tsx tools/near/accounts.ts root <name.testnet> | sub <full.sub.account> <NEAR> | status
import fs from 'node:fs';
import path from 'node:path';
import { KeyPair, nearToYocto, yoctoToNear } from 'near-api-js';
import { NETWORK, account, accountExists, hasKey, loadPublicKey, provider, saveKey, KEYS_DIR, ensurePrivateDir } from './lib.ts';

const FAUCET = 'https://helper.nearprotocol.com/account';
const [command, ...rest] = process.argv.slice(2);

async function root(name: string) {
  if (!/^[a-z0-9-]{2,40}\.testnet$/.test(name)) throw new Error('root must look like name.testnet');
  if (await accountExists(name)) { if (!hasKey(name)) throw new Error(`${name} exists but its key is not in ${KEYS_DIR}`); console.log('exists', name); return; }
  const keyPair = KeyPair.fromRandom('ed25519');
  saveKey(name, keyPair);
  const response = await fetch(FAUCET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: name, newAccountPublicKey: keyPair.getPublicKey().toString() }), signal: AbortSignal.timeout(60_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`faucet ${response.status}: ${text.slice(0, 300)}`);
  console.log('created', name);
}
async function sub(name: string, near: string) {
  const parent = name.split('.').slice(1).join('.');
  if (await accountExists(name)) { if (!hasKey(name)) throw new Error(`${name} exists but its key is not in ${KEYS_DIR}`); console.log('exists', name); return; }
  const keyPair = KeyPair.fromRandom('ed25519');
  saveKey(name, keyPair);
  await account(parent).createAccount({ newAccountId: name, publicKey: keyPair.getPublicKey(), nearToTransfer: nearToYocto(near) });
  console.log('created', name, near, 'NEAR');
}
async function status() {
  ensurePrivateDir();
  const names = fs.readdirSync(KEYS_DIR).filter(file => file.endsWith('.testnet.json')).map(file => file.slice(0, -5)).sort((a, b) => a.split('.').length - b.split('.').length || a.localeCompare(b));
  const rows = [];
  for (const name of names) {
    const exists = await accountExists(name);
    const state = exists ? await provider.viewAccount({ accountId: name }) : null;
    rows.push({ account: name, public_key: loadPublicKey(name), near: state ? Number(yoctoToNear(state.amount, 4)) : null });
  }
  console.table(rows.map(({ account: id, near }) => ({ account: id, near })));
  const out = path.resolve('near-hackathon/near-accounts.json');
  fs.writeFileSync(out, JSON.stringify({ network: NETWORK, note: 'Public account ids and public keys only. Private keys are outside the repository.', accounts: rows.map(({ account: id, public_key }) => ({ account: id, public_key })) }, null, 2) + '\n');
  console.log('wrote', out);
}

if (command === 'root') await root(rest[0]);
else if (command === 'sub') await sub(rest[0], rest[1] ?? '1');
else if (command === 'status') await status();
else { console.error('usage: root <name.testnet> | sub <account> <NEAR> | status'); process.exit(2); }
