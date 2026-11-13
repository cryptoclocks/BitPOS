// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// The only file that talks to NEAR. Everything else uses the NearChain interface, so tests can
// replace the chain with a stub. Testnet only: mainnet is refused until the owner authorises it.
import fs from 'node:fs';
import path from 'node:path';
import { Account, JsonRpcProvider, actions, decodeSignedDelegate, encodeSignedDelegate, nearToYocto, teraToGas, type SignedDelegate } from 'near-api-js';

export interface NearSettings {
  network: 'testnet';
  rpcUrls: string[];
  billsContract: string;
  relayerAccount: string;
  /** Folder outside the repository holding keys/<account>[.label].json */
  privateDir: string;
  explorerTx: string;
}
export type BillState = 'Open' | 'Escrow' | 'Settling' | 'Settled' | 'PayoutFailed' | 'Refunding' | 'Refunded' | 'Void';
export interface ChainPayout { account: string; amount: string; role: string }
export interface ChainBill {
  merchant: string; bill_id: string; token: string; total: string; payouts: ChainPayout[];
  expires_at_ms: string; witness_pk: string | null; witness_timeout_ms: string;
  state: BillState; payer: string | null; paid_at_ms: string; closed_at_ms: string;
}
export interface ChainEvent { executor: string; standard: string; event: string; data: Record<string, unknown> }
export interface TxView {
  hash: string;
  signer: string;
  /** true only when the node reports FINAL */
  final: boolean;
  /** no receipt failed */
  ok: boolean;
  failures: string[];
  events: ChainEvent[];
}
export interface OpenBillInput {
  billId: string; token: string; total: bigint; payouts: { account: string; amount: bigint; role: string }[];
  expiresAtMs: number; witnessPk: string | null; witnessTimeoutMs: number;
}
export interface DelegateSummary {
  sender: string; receiver: string;
  calls: { method: string; args: unknown; gas: bigint; deposit: bigint }[];
  otherActions: number;
}
/** AI spending pass, as stored by the bills contract (amounts in token minor units, as strings). */
export interface ChainPass {
  owner: string; pass_id: string; agent: string; token: string; cap: string; balance: string; max_bill: string;
  merchant: string | null; created_at_ms: string; expires_at_ms: string; bills_paid: number; closed: boolean;
}
export const PASS_TTLS_MS = { '30m': 1_800_000, '1h': 3_600_000, '1d': 86_400_000, '1w': 604_800_000, '1mo': 2_592_000_000 } as const;
export type PassTtl = keyof typeof PASS_TTLS_MS;
export const passMessage = (input: { passId: string; agent: string; ttlMs: number; maxBill: bigint; merchant: string | null }) =>
  JSON.stringify({ pass: { id: input.passId, agent: input.agent, ttl_ms: String(input.ttlMs), max_bill: input.maxBill.toString(), ...(input.merchant ? { merchant: input.merchant } : {}) } });
export interface NearChain {
  settings: NearSettings;
  getBill(merchant: string, billId: string): Promise<ChainBill | null>;
  openBill(merchant: string, input: OpenBillInput): Promise<TxView>;
  voidBill(merchant: string, billId: string): Promise<TxView>;
  merchantRefund(merchant: string, billId: string): Promise<TxView>;
  deviceAck(merchant: string, billId: string, signatureHex: string): Promise<TxView>;
  reclaim(merchant: string, billId: string): Promise<TxView>;
  retryPayout(merchant: string, billId: string): Promise<TxView>;
  /** Decodes a base64 signed delegate without sending it. */
  inspectDelegate(base64: string): DelegateSummary;
  /** Sends an already validated signed delegate; the relayer pays the gas. */
  relay(base64: string): Promise<TxView>;
  tx(hash: string, signer: string): Promise<TxView>;
  ftBalance(token: string, accountId: string): Promise<bigint>;
  isRegistered(token: string, accountId: string): Promise<boolean>;
  register(token: string, accountId: string): Promise<TxView>;
  accountExists(accountId: string): Promise<boolean>;
  /** Demo wallets only: signs a gasless payment with a testnet key held by the server. */
  signDemoPayment(customer: string, token: string, amount: bigint, msg: string): Promise<string>;
  hasKey(accountId: string, label?: string): boolean;
  getPass(owner: string, passId: string): Promise<ChainPass | null>;
  /** Signed with the agent's function-call key: it can call `pass_pay` and nothing else. */
  passPay(agent: string, owner: string, passId: string, merchant: string, billId: string): Promise<TxView>;
  /** `signer` is the owner (any time) or the relayer (only after expiry: the contract decides). */
  passClose(signer: string, owner: string, passId: string): Promise<TxView>;
  /** Testnet demo faucet: the test token's own account sends a small amount. Only for tokens whose key the server holds. */
  faucet(token: string, accountId: string, amount: bigint): Promise<TxView>;
}

export const PAY_GAS = teraToGas('250');
const CALL_GAS = teraToGas('200');
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export const isAccountId = (value: unknown): value is string => typeof value === 'string' && value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value);
export const payMessage = (merchant: string, billId: string) => JSON.stringify({ m: merchant, b: billId });
export const witnessMessage = (contract: string, merchant: string, billId: string) => `bitpos-near-ack:v1:${contract}:${merchant}:${billId}`;

type RawOutcome = { final_execution_status?: string; status?: unknown; transaction?: { hash?: string; signer_id?: string }; transaction_outcome?: { outcome?: { status?: unknown } }; receipts_outcome?: { outcome?: { executor_id?: string; logs?: string[]; status?: unknown } }[] };
const failureOf = (status: unknown) => status && typeof status === 'object' && 'Failure' in status ? JSON.stringify((status as { Failure: unknown }).Failure).slice(0, 400) : null;

/** Turns an RPC transaction result into the few facts the verifier needs. Pure, used with fixtures in tests. */
export function txView(raw: unknown): TxView {
  const outcome = raw as RawOutcome;
  const failures: string[] = [];
  const events: ChainEvent[] = [];
  const top = failureOf(outcome.status) ?? failureOf(outcome.transaction_outcome?.outcome?.status);
  if (top) failures.push(top);
  for (const receipt of outcome.receipts_outcome ?? []) {
    const failed = failureOf(receipt.outcome?.status);
    if (failed) failures.push(failed);
    for (const log of receipt.outcome?.logs ?? []) {
      if (!log.startsWith('EVENT_JSON:')) continue;
      try {
        const parsed = JSON.parse(log.slice(11)) as { standard?: unknown; event?: unknown; data?: unknown };
        for (const data of Array.isArray(parsed.data) ? parsed.data : []) events.push({ executor: String(receipt.outcome?.executor_id ?? ''), standard: String(parsed.standard ?? ''), event: String(parsed.event ?? ''), data: (data ?? {}) as Record<string, unknown> });
      } catch { /* not an event we understand */ }
    }
  }
  return { hash: String(outcome.transaction?.hash ?? ''), signer: String(outcome.transaction?.signer_id ?? ''), final: outcome.final_execution_status === 'FINAL', ok: failures.length === 0, failures: [...new Set(failures)], events };
}

export function realChain(settings: NearSettings): NearChain {
  if (settings.network !== 'testnet') throw new Error('NEAR mainnet is not enabled');
  const providers = settings.rpcUrls.map(url => new JsonRpcProvider({ url }));
  let preferred = 0;
  /** Tries each RPC once, starting with the last one that answered. Contract errors are not retried. */
  async function rpc<T>(run: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < providers.length; attempt++) {
      const index = (preferred + attempt) % providers.length;
      try { const value = await run(providers[index]); preferred = index; return value; }
      catch (error) {
        last = error;
        const name = `${(error as Error)?.constructor?.name ?? ''} ${(error as Error)?.message ?? ''}`;
        if (!/fetch|network|timeout|ECONN|ENOTFOUND|429|50\d|Too Many|rate/i.test(name)) throw error;
      }
    }
    throw last;
  }
  const keyFile = (accountId: string, label = '') => path.join(settings.privateDir, 'keys', `${accountId}${label ? `.${label}` : ''}.json`);
  const hasKey = (accountId: string, label = '') => fs.existsSync(keyFile(accountId, label));
  const signers = new Map<string, Account>();
  function signer(accountId: string, label = '') {
    const cached = signers.get(`${accountId}|${label}`);
    if (cached) return cached;
    const secret = JSON.parse(fs.readFileSync(keyFile(accountId, label), 'utf8')).private_key as string;
    const created = new Account(accountId, providers[preferred], secret as never);
    signers.set(`${accountId}|${label}`, created);
    return created;
  }
  // One transaction at a time per signing key, so nonces never collide.
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (queues.get(key) ?? Promise.resolve()).then(run, run);
    queues.set(key, next.catch(() => undefined));
    return next;
  }
  const call = (accountId: string, label: string, contractId: string, methodName: string, args: Record<string, unknown>, deposit = 0n, gas = CALL_GAS) =>
    serial(`${accountId}|${label}`, async () => txView(await signer(accountId, label).callFunctionRaw({ contractId, methodName, args, gas, deposit, waitUntil: 'FINAL' })));
  // Views read finalized state only: an optimistic answer is never treated as a payment fact.
  const view = <T>(contractId: string, method: string, args: Record<string, unknown>) => rpc(provider => provider.callFunction({ contractId, method, args, blockQuery: { finality: 'final' } })) as Promise<T>;
  const bills = settings.billsContract, relayer = settings.relayerAccount;

  return {
    settings,
    hasKey,
    getBill: (merchant, billId) => view<ChainBill | null>(bills, 'get_bill', { merchant, bill_id: billId }),
    openBill: (merchant, input) => call(merchant, 'cashier', bills, 'open_bill', {
      bill_id: input.billId, token: input.token, total: input.total.toString(),
      payouts: input.payouts.map(payout => ({ account: payout.account, amount: payout.amount.toString(), role: payout.role })),
      expires_at_ms: String(input.expiresAtMs), witness_pk: input.witnessPk, witness_timeout_ms: String(input.witnessTimeoutMs),
    }, 0n, teraToGas('30')),
    voidBill: (merchant, billId) => call(merchant, 'cashier', bills, 'void_bill', { bill_id: billId }, 0n, teraToGas('30')),
    merchantRefund: (merchant, billId) => call(merchant, 'cashier', bills, 'merchant_refund', { bill_id: billId }, 0n, teraToGas('60')),
    deviceAck: (merchant, billId, signature) => call(relayer, '', bills, 'device_ack', { merchant, bill_id: billId, signature }),
    reclaim: (merchant, billId) => call(relayer, '', bills, 'reclaim', { merchant, bill_id: billId }, 0n, teraToGas('60')),
    retryPayout: (merchant, billId) => call(relayer, '', bills, 'retry_payout', { merchant, bill_id: billId }),
    inspectDelegate(base64) {
      const delegate = decodeSignedDelegate(Buffer.from(base64, 'base64')).delegateAction;
      const calls: DelegateSummary['calls'] = [];
      let otherActions = 0;
      for (const action of delegate.actions as unknown as { functionCall?: { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint } }[]) {
        const fn = action.functionCall;
        if (!fn) { otherActions++; continue; }
        let args: unknown = null;
        try { args = JSON.parse(Buffer.from(fn.args).toString('utf8')); } catch { /* left null: refused by the caller */ }
        calls.push({ method: fn.methodName, args, gas: BigInt(fn.gas), deposit: BigInt(fn.deposit) });
      }
      return { sender: delegate.senderId, receiver: delegate.receiverId, calls, otherActions };
    },
    relay: base64 => serial(`${relayer}|`, async () => {
      const signed: SignedDelegate = decodeSignedDelegate(Buffer.from(base64, 'base64'));
      const sent = await signer(relayer).relayMetaTransaction(signed);
      const hash = (sent as { transaction: { hash: string } }).transaction.hash;
      return txView(await rpc(provider => provider.viewTransactionStatusWithReceipts({ txHash: hash, accountId: relayer, waitUntil: 'FINAL' })));
    }),
    tx: async (hash, signerId) => txView(await rpc(provider => provider.viewTransactionStatusWithReceipts({ txHash: hash, accountId: signerId, waitUntil: 'FINAL' }))),
    ftBalance: async (token, accountId) => BigInt(await view<string>(token, 'ft_balance_of', { account_id: accountId })),
    isRegistered: async (token, accountId) => Boolean(await view(token, 'storage_balance_of', { account_id: accountId })),
    register: (token, accountId) => call(relayer, '', token, 'storage_deposit', { account_id: accountId, registration_only: true }, nearToYocto('0.00125'), teraToGas('30')),
    async accountExists(accountId) {
      try { await rpc(provider => provider.viewAccount({ accountId })); return true; }
      catch (error) { if (/AccountDoesNotExist|UNKNOWN_ACCOUNT|does not exist/i.test(`${(error as Error)?.constructor?.name} ${(error as Error)?.message}`)) return false; throw error; }
    },
    getPass: (owner, passId) => view<ChainPass | null>(bills, 'get_pass', { owner, pass_id: passId }),
    passPay: (agent, owner, passId, merchant, billId) => call(agent, 'pass', bills, 'pass_pay', { owner, pass_id: passId, merchant, bill_id: billId }),
    passClose: (signerId, owner, passId) => call(signerId, '', bills, 'pass_close', { owner, pass_id: passId }, 0n, teraToGas('60')),
    faucet: (token, accountId, amount) => call(token, '', token, 'ft_transfer', { receiver_id: accountId, amount: amount.toString(), memo: 'BitPOS demo faucet' }, 1n, teraToGas('30')),
    async signDemoPayment(customer, token, amount, msg) {
      const { signedDelegate } = await signer(customer).createSignedMetaTransaction({
        receiverId: token, blockHeightTtl: 120,
        actions: [actions.functionCall('ft_transfer_call', { receiver_id: bills, amount: amount.toString(), msg }, PAY_GAS, 1n)],
      });
      return Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64');
    },
  };
}
