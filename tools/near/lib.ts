// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// Shared helpers for the NEAR testnet tools. Keys live outside the repository.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair } from 'near-api-js';

export const NETWORK = 'testnet';
export const RPC_URLS = (process.env.NEAR_RPC_URLS ?? 'https://test.rpc.fastnear.com,https://near-testnet.drpc.org').split(',');
export const PRIVATE_DIR = process.env.BITPOS_NEAR_PRIVATE_DIR ?? path.join(os.homedir(), '.bitpos-near', NETWORK);
export const KEYS_DIR = path.join(PRIVATE_DIR, 'keys');
export const EXPLORER_TX = 'https://testnet.nearblocks.io/txns/';

export const provider = new FailoverRpcProvider(RPC_URLS.map(url => new JsonRpcProvider({ url })));

export function ensurePrivateDir() {
  fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(PRIVATE_DIR), 0o700);
  fs.chmodSync(PRIVATE_DIR, 0o700);
  fs.chmodSync(KEYS_DIR, 0o700);
}
const keyFile = (accountId: string, label = '') => path.join(KEYS_DIR, `${accountId}${label ? `.${label}` : ''}.json`);
export const hasKey = (accountId: string, label = '') => fs.existsSync(keyFile(accountId, label));
/** `label` names an extra, restricted key of the same account (for example "cashier"). */
export function saveKey(accountId: string, keyPair: KeyPair, label = '') {
  ensurePrivateDir();
  fs.writeFileSync(keyFile(accountId, label), JSON.stringify({ account_id: accountId, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }), { mode: 0o600 });
}
export function loadSecret(accountId: string, label = ''): string {
  return JSON.parse(fs.readFileSync(keyFile(accountId, label), 'utf8')).private_key;
}
export function loadPublicKey(accountId: string, label = ''): string {
  return JSON.parse(fs.readFileSync(keyFile(accountId, label), 'utf8')).public_key;
}
export const account = (accountId: string, label = '') => new Account(accountId, provider, loadSecret(accountId, label) as never);

const plain = new JsonRpcProvider({ url: RPC_URLS[0] });
export async function accountExists(accountId: string): Promise<boolean> {
  try { await plain.viewAccount({ accountId }); return true; }
  catch (error) {
    const text = `${(error as Error)?.name ?? ''} ${(error as Error)?.constructor?.name ?? ''} ${(error as Error)?.message ?? error}`;
    if (/AccountDoesNotExist|UNKNOWN_ACCOUNT|does not exist/i.test(text)) return false;
    throw error;
  }
}
export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return await plain.callFunction({ contractId, method, args }) as T;
}
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
