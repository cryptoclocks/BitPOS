import { getWallets } from '@wallet-standard/app';
import { Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { z } from 'zod';

export interface ConnectedWallet {
  address: string;
  name: string;
  fixture: boolean;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
}
export interface PhantomProvider {
  isPhantom?: boolean;
  isBitPOSTestFixture?: boolean;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, encoding: 'utf8'): Promise<{ signature: Uint8Array }>;
  signTransaction(transaction: Transaction | VersionedTransaction): Promise<Transaction | VersionedTransaction>;
}
export function phantomBrowseUrl(url: string): string {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Invalid payment URL');
  return `https://phantom.app/ul/browse/${encodeURIComponent(target.href)}?ref=${encodeURIComponent(target.origin)}`;
}
export async function connectPhantom(provider: PhantomProvider): Promise<ConnectedWallet> {
  const { publicKey } = await provider.connect();
  return {
    address: publicKey.toString(), name: provider.isBitPOSTestFixture ? 'TEST WALLET FIXTURE' : 'Phantom', fixture: !!provider.isBitPOSTestFixture,
    async signMessage(message) { return (await provider.signMessage(message, 'utf8')).signature; },
    async signTransaction(bytes) {
      let transaction: Transaction | VersionedTransaction;
      try { transaction = Transaction.from(bytes); } catch { transaction = VersionedTransaction.deserialize(bytes); }
      const signed = await provider.signTransaction(transaction);
      return signed instanceof Transaction ? signed.serialize({ requireAllSignatures: false, verifySignatures: false }) : signed.serialize();
    },
  };
}
interface StandardAccount { address: string; chains: readonly string[] }
interface SolanaFeatures {
  'standard:connect': { connect(): Promise<{ accounts: StandardAccount[] }> };
  'solana:signMessage': { signMessage(input: { account: StandardAccount; message: Uint8Array }): Promise<{ signature: Uint8Array }[]> };
  'solana:signTransaction': { signTransaction(input: { account: StandardAccount; transaction: Uint8Array; chain: string }): Promise<{ signedTransaction: Uint8Array }[]> };
}
export type PaymentRequest = <T>(path: string, body: unknown) => Promise<T>;
export interface WalletChoice { name: string; connect(): Promise<ConnectedWallet> }
export interface TestWalletProvider {
  isBitPOSTestFixture: true;
  connect(): Promise<{ address: string }>;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
}
export async function discoverWallets(): Promise<WalletChoice[]> {
  const wallets = getWallets().get().filter(wallet => wallet.features['standard:connect'] && wallet.features['solana:signMessage'] && wallet.features['solana:signTransaction']);
  const choices = wallets.map(wallet => ({ name: wallet.name, async connect(): Promise<ConnectedWallet> {
    // Capability-filtered Wallet Standard feature contracts.
    const features = wallet.features as unknown as SolanaFeatures;
    const { accounts } = await features['standard:connect'].connect();
    const account = accounts.find(candidate => candidate.chains.includes('solana:devnet'));
    if (!account) throw new Error('Wallet must support Solana devnet');
    return { address: account.address, name: wallet.name, fixture: false,
      async signMessage(message) { const [result] = await features['solana:signMessage'].signMessage({ account, message }); return result.signature; },
      async signTransaction(transaction) { const [result] = await features['solana:signTransaction'].signTransaction({ account, transaction, chain: 'solana:devnet' }); return result.signedTransaction; },
    };
  } }));
  const host = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider; __BITPOS_TEST_WALLET__?: TestWalletProvider };
  const provider = host.phantom?.solana ?? (host.solana?.isPhantom ? host.solana : undefined);
  if (provider && !choices.some(choice => choice.name === 'Phantom')) choices.push({ name: 'Phantom', connect: () => connectPhantom(provider) });
  // Explicit opt-in on localhost only. Automation installs its own signing provider; no private keys bundled.
  if (['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('testWallet') === '1' && host.__BITPOS_TEST_WALLET__?.isBitPOSTestFixture) {
    const fixture = host.__BITPOS_TEST_WALLET__;
    choices.push({ name: 'TEST WALLET FIXTURE (not mobile)', async connect() {
      const { address } = await fixture.connect();
      return { address, name: 'TEST WALLET FIXTURE', fixture: true, signMessage: message => fixture.signMessage(message), signTransaction: transaction => fixture.signTransaction(transaction) };
    } });
  }
  return choices;
}
export async function bindWallet(token: string, wallet: ConnectedWallet, request: PaymentRequest) {
  const root = `/pay/${encodeURIComponent(token)}`;
  const challenge = z.object({ id: z.string().min(1), message: z.string().min(1), expiresAt: z.iso.datetime({ offset: true }) }).parse(await request<unknown>(`${root}/challenge`, { address: wallet.address }));
  if (Date.parse(challenge.expiresAt) <= Date.now()) throw new Error('Wallet challenge expired');
  const signature = await wallet.signMessage(new TextEncoder().encode(challenge.message));
  return z.object({ payer: z.string().min(1), avatar: z.string() }).parse(await request<unknown>(`${root}/bind`, { challengeId: challenge.id, signature: bs58.encode(signature) }));
}
const signedPendingSchema=z.object({address:z.string().min(1),attemptId:z.string().min(1),base64:z.string().min(1).max(8192)}).strict();
const pendingKey=(token:string)=>'bitpos-signed-payment:'+token;
export function pendingPayment(token:string){if(typeof window==='undefined')return null;const raw=window.localStorage.getItem(pendingKey(token));return raw?signedPendingSchema.parse(JSON.parse(raw)):null;}
export function forgetPayment(token:string){if(typeof window!=='undefined')window.localStorage.removeItem(pendingKey(token));}
export async function resumePayment(token:string,request:PaymentRequest){const saved=pendingPayment(token);if(!saved)throw new Error('No saved payment.');return z.object({signature:z.string().min(1),status:z.string().min(1)}).parse(await request<unknown>(`/pay/${encodeURIComponent(token)}/submit`,{attemptId:saved.attemptId,base64:saved.base64}));}
export async function submitPayment(token: string, wallet: ConnectedWallet, request: PaymentRequest, progress?:(phase:'signing'|'submitting')=>void) {
  const saved=pendingPayment(token);if(saved){if(saved.address!==wallet.address)throw new Error('Saved payment uses another wallet.');progress?.('submitting');return resumePayment(token,request);}
  const root = `/pay/${encodeURIComponent(token)}`;
  const attempt = z.object({ id: z.string().min(1), base64: z.string().min(1) }).parse(await request<unknown>(`${root}/attempt`, { address: wallet.address }));
  const bytes = Uint8Array.from(atob(attempt.base64), char => char.charCodeAt(0));
  progress?.('signing');const signed = await wallet.signTransaction(bytes);
  const base64=btoa(Array.from(signed,byte=>String.fromCharCode(byte)).join(''));
  if(typeof window!=='undefined')window.localStorage.setItem(pendingKey(token),JSON.stringify({address:wallet.address,attemptId:attempt.id,base64}));
  progress?.('submitting');
  // Signing is not settlement; the API persists, submits and verifies.
  return z.object({ signature: z.string().min(1), status: z.string().min(1) }).parse(await request<unknown>(`${root}/submit`, { attemptId: attempt.id, base64 }));
}
export function avatar(address: string): { color: string; cells: boolean[] } {
  let hash = 2166136261;
  for (const char of address) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const cells = Array.from({ length: 25 }, (_, index) => {
    const x = index % 5; const y = Math.floor(index / 5); const bit = y * 3 + Math.min(x, 4 - x);
    return !!(hash & (1 << bit));
  });
  return { color: `hsl(${hash % 360} 65% 42%)`, cells };
}
