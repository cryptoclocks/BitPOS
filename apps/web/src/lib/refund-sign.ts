import { api } from './api';
import type { ConnectedWallet } from './wallet';

// Owner-signed store refund, browser side. BitPOS holds no key: the server prepares the exact unsigned refund transaction (fee payer = the shop's treasury wallet),
// the shop owner signs it in their OWN wallet, and the signed bytes go back to the server, which accepts them only if they equal the prepared message with the
// treasury's valid signature. Signing is not the refund: the refund is complete only when the server verifies it on chain.
export interface PreparedRefund { refundId: string; sourceOwner: string; beneficiary: string; amountMinor: string; unsignedBase64: string; lastValidBlockHeight: number }
export class WalletMismatch extends Error { constructor(public readonly expected: string, public readonly actual: string) { super('WALLET_MISMATCH'); } }

export const shortAddress = (address: string) => address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
export const decodeBase64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));
export const encodeBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));

/** Connect, check this is the treasury wallet, fetch a fresh unsigned transaction, sign it and hand it back. */
export async function signOwnerRefund(orderId: string, token: string, wallet: ConnectedWallet, expectedOwner: string) {
  if (wallet.address !== expectedOwner) throw new WalletMismatch(expectedOwner, wallet.address);
  const prepared = await api<PreparedRefund>(`/bills/orders/${orderId}/refund/prepare`, {}, token);
  if (prepared.sourceOwner !== wallet.address) throw new WalletMismatch(prepared.sourceOwner, wallet.address);
  const signed = await wallet.signTransaction(decodeBase64(prepared.unsignedBase64));
  return api<{ refund: { id: string; state: string; signature: string | null } }>(`/bills/orders/${orderId}/refund/submit`, { base64: encodeBase64(signed) }, token);
}
export async function cancelOwnerRefund(orderId: string, token: string) {
  return api<{ cancelled: boolean }>(`/bills/orders/${orderId}/refund/cancel`, {}, token);
}
