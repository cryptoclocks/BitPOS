// NEAR HACKATHON work (2026-11-14). See near-hackathon/PROVENANCE.md.
// The customer's own NEAR wallet on testnet, through @hot-labs/near-connect. Loaded only when the customer asks to
// connect, so the pay page works without it. Nothing here decides that a bill is paid: the wallet only produces a
// signed payment, and the server reads the contract.
export interface NearPayRequest { token: string; contract: string; amountUnits: string; msg: string }
export interface NearWalletSession {
  accountId: string; walletName: string;
  /** The wallet says it can sign a delegate action (gasless: the café's relayer pays the network fee). */
  canDelegate: boolean;
  /** Returns the Borsh-encoded SignedDelegate as base64, ready for POST …/near/relay. */
  signGasless(request: NearPayRequest): Promise<string>;
  /** The wallet sends the transaction itself (the customer pays the network fee). */
  payDirect(request: NearPayRequest): Promise<{ txHash: string; signerId: string }>;
  disconnect(): Promise<void>;
}
// The narrow part of the library's surface this page uses (its own .d.ts needs @near-js types we do not install).
interface LibAccount { accountId: string }
interface LibAction { type: 'FunctionCall'; params: { methodName: string; args: object; gas: string; deposit: string } }
interface LibWallet {
  manifest: { name: string; features: { signDelegateActions?: boolean } };
  getAccounts(data?: { network?: 'testnet' }): Promise<LibAccount[]>;
  signAndSendTransaction(params: { network?: 'testnet'; signerId?: string; receiverId: string; actions: LibAction[] }): Promise<unknown>;
  signDelegateActions(params: { network?: 'testnet'; signerId?: string; delegateActions: { receiverId: string; actions: LibAction[] }[] }): Promise<{ signedDelegateActions: unknown[] }>;
}
interface LibConnector { whenManifestLoaded: Promise<void>; connect(): Promise<LibWallet>; disconnect(wallet?: LibWallet): Promise<void>; getConnectedWallet(): Promise<{ wallet: LibWallet; accounts: LibAccount[] }> }

const PAY_GAS = '250000000000000';
const action = (request: NearPayRequest): LibAction => ({ type: 'FunctionCall', params: { methodName: 'ft_transfer_call', args: { receiver_id: request.contract, amount: request.amountUnits, msg: request.msg }, gas: PAY_GAS, deposit: '1' } });

function toBase64(bytes: Uint8Array): string { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text); }
/** Wallets return the signed delegate as base64 (sometimes base64url, hex or raw bytes): normalise to plain base64. */
export function normaliseSignedDelegate(value: unknown): string {
  if (value instanceof Uint8Array) return toBase64(value);
  if (Array.isArray(value) && value.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) return toBase64(Uint8Array.from(value as number[]));
  if (typeof value !== 'string' || !value) throw new Error('The wallet returned no signed payment.');
  if (/^(0x)?([0-9a-f]{2})+$/i.test(value) && !/[g-zG-Z+/=_-]/.test(value)) { const hex = value.replace(/^0x/i, ''); return toBase64(Uint8Array.from(hex.match(/../g)!.map(pair => parseInt(pair, 16)))); }
  const plain = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(plain)) throw new Error('The wallet returned a signed payment in a format this page does not know.');
  return plain.padEnd(Math.ceil(plain.length / 4) * 4, '=');
}
function txFacts(outcome: unknown, fallbackSigner: string) {
  const o = outcome as { transaction?: { hash?: string; signer_id?: string }; transaction_outcome?: { id?: string } } | null;
  const txHash = o?.transaction?.hash ?? o?.transaction_outcome?.id;
  if (typeof txHash !== 'string' || !txHash) throw new Error('The wallet did not report a transaction.');
  return { txHash, signerId: o?.transaction?.signer_id ?? fallbackSigner };
}

let connector: Promise<LibConnector> | undefined;
function library(): Promise<LibConnector> {
  connector ??= import('@hot-labs/near-connect').then(async module => {
    const created = new module.NearConnector({ network: 'testnet', features: { testnet: true, signAndSendTransaction: true } }) as unknown as LibConnector;
    await created.whenManifestLoaded; return created;
  });
  connector.catch(() => { connector = undefined; });
  return connector;
}
function session(lib: LibConnector, wallet: LibWallet, accountId: string): NearWalletSession {
  return {
    accountId, walletName: wallet.manifest?.name ?? 'NEAR wallet', canDelegate: wallet.manifest?.features?.signDelegateActions === true,
    async signGasless(request) {
      const signed = await wallet.signDelegateActions({ network: 'testnet', signerId: accountId, delegateActions: [{ receiverId: request.token, actions: [action(request)] }] });
      return normaliseSignedDelegate(signed?.signedDelegateActions?.[0]);
    },
    async payDirect(request) { return txFacts(await wallet.signAndSendTransaction({ network: 'testnet', signerId: accountId, receiverId: request.token, actions: [action(request)] }), accountId); },
    async disconnect() { await lib.disconnect(wallet); },
  };
}
/** Opens the wallet chooser (testnet wallets only) and returns the connected account. */
export async function connectNearWallet(): Promise<NearWalletSession> {
  const lib = await library(); const wallet = await lib.connect();
  const accounts = await wallet.getAccounts({ network: 'testnet' });
  if (!accounts[0]?.accountId) throw new Error('The wallet did not share an account.');
  return session(lib, wallet, accounts[0].accountId);
}
/** A wallet connected on an earlier visit, or null. Never opens a window. */
export async function restoreNearWallet(): Promise<NearWalletSession | null> {
  try { const lib = await library(); const { wallet, accounts } = await lib.getConnectedWallet(); return accounts[0]?.accountId ? session(lib, wallet, accounts[0].accountId) : null; }
  catch { return null; }
}
