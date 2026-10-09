import type { CartItem } from '../../../../packages/contracts/src/index';
import type { CounterRequest, ReviewQuote, ServingSelection, Session } from './table';
import { z } from 'zod';
export interface Draft { items: CartItem[]; customerId: string; serving: ServingSelection }
export type CounterState = Draft & { revision: number } & (
  | { phase: 'draft'; reason: string }
  | { phase: 'review'; quote: ReviewQuote; deadline: number }
  | { phase: 'pending'; request: CounterRequest; quote: ReviewQuote }
  | { phase: 'order'; orderId: string }
);
export const emptyDraft: CounterState = { revision: 0, items: [], customerId: '', serving: { kind: 'counter' }, phase: 'draft', reason: '' };
const digits = z.string().regex(/^(0|[1-9]\d*)$/);
const cartItems = z.array(z.object({ productId: z.string().min(1), qty: z.number().int().min(1).max(100) }).strict()).max(50).refine(items => new Set(items.map(item => item.productId)).size === items.length);
const servingSchema = z.union([z.object({ kind: z.literal('table'), tableId: z.string().min(1) }).strict(), z.object({ kind: z.enum(['counter', 'takeaway']) }).strict()]);
const moneySchema = z.union([z.object({ currency: z.enum(['USD', 'THB']), decimals: z.literal(2), amountMinor: digits }), z.object({ currency: z.literal('USDG'), decimals: z.literal(6), amountMinor: digits })]);
const promotionSchema = z.object({ priceVersion: z.string(), revision: digits, expiresAt: z.iso.datetime({ offset: true }), discount: z.union([z.object({ kind: z.literal('percent'), percent: z.number().int().min(1).max(99) }), z.object({ kind: z.literal('amount'), amountMinor: digits })]) });
const authoritySchema = z.object({ kind: z.literal('versioned'), source: z.union([z.object({ kind: z.literal('register'), registerId: z.string(), label: z.string() }), z.object({ kind: z.literal('device'), deviceId: z.string(), label: z.string() })]), serving: z.union([z.object({ kind: z.literal('table'), tableId: z.string(), label: z.string() }), z.object({ kind: z.enum(['counter', 'takeaway', 'legacy_unknown']), label: z.string() })]), target: z.object({ deviceId: z.string(), assignmentGeneration: digits }), pairingGeneration: digits.nullable() });
const quoteSchema = z.object({
  id: z.string().min(1), priceVersion: z.string().min(1), pricingRevision: digits, cartVersion: digits.nullable(),
  lines: z.array(z.object({ productId: z.string(), name: z.string(), nameEn: z.string(), qty: z.number().int().min(1).max(100), priceVersion: z.string(), basePrice: moneySchema, unitPrice: moneySchema, promotion: promotionSchema.nullable() })).min(1).max(50),
  total: moneySchema, settlement: z.object({ currency: z.literal('USDG'), decimals: z.literal(6), amountMinor: digits, network: z.literal('solana:devnet'), genesisHash: z.string(), mint: z.string(), tokenProgram: z.string(), testToken: z.literal(true), recipient: z.string(), sponsor: z.literal('merchant_funded') }),
  quotedAt: z.iso.datetime({ offset: true }), validUntil: z.iso.datetime({ offset: true }), authority: authoritySchema,
  pairingGeneration: digits, targetOnline: z.boolean(), targetBusy: z.boolean(),
});
const draftShape = { revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), items: cartItems, customerId: z.string(), serving: servingSchema };
const pendingRequest = z.object({ items: cartItems, customerId: z.string().optional(), serving: servingSchema, quoteId: z.string().min(1), priceVersion: z.string().min(1), idempotencyKey: z.string().min(1) }).strict();
const stateSchema = z.discriminatedUnion('phase', [
  z.object({ ...draftShape, phase: z.literal('draft'), reason: z.string() }).strict(),
  z.object({ ...draftShape, phase: z.literal('review'), quote: quoteSchema, deadline: z.number().finite() }).strict(),
  z.object({ ...draftShape, phase: z.literal('pending'), quote: quoteSchema, request: pendingRequest }).strict(),
  z.object({ ...draftShape, phase: z.literal('order'), orderId: z.string().min(1) }).strict(),
]);
export function restoreCounter(value: unknown): CounterState {
  if (value === undefined) return { ...emptyDraft };
  const saved = stateSchema.parse(value);
  if (saved.phase === 'pending' && (saved.request.quoteId !== saved.quote.id || saved.request.priceVersion !== saved.quote.priceVersion || JSON.stringify(saved.request.items) !== JSON.stringify(saved.items) || JSON.stringify(saved.request.serving) !== JSON.stringify(saved.serving) || (saved.request.customerId ?? '') !== saved.customerId)) throw new Error('Corrupt pending submission journal. No replacement order is permitted.');
  // Reload cannot inherit a prior user's confirmation.
  return saved.phase === 'review' ? refuseSubmission(saved, 'Reloaded draft: review again.') : saved;
}
export function counterScope(session: Session, registerId: string): string {
  return JSON.stringify([session.merchantId, session.userId, registerId]);
}
export function editDraft(state: CounterState, change: Partial<Draft>): CounterState {
  if (state.phase === 'pending') throw new Error('Resolve the pending submission before editing this draft.');
  return { items: state.items, customerId: state.customerId, serving: state.serving, ...change, revision: state.revision, phase: 'draft', reason: '' };
}
export function setQuantity(state: CounterState, productId: string, qty: number): CounterState {
  if (!Number.isInteger(qty) || qty < 0 || qty > 100) throw new Error('Quantity must be between 0 and 100.');
  const items = state.items.filter(item => item.productId !== productId);
  if (qty) items.push({ productId, qty });
  if (items.length > 50) throw new Error('A cart supports at most 50 distinct products.');
  items.sort((a, b) => a.productId.localeCompare(b.productId));
  return editDraft(state, { items });
}
export function acceptReview(state: CounterState, quote: ReviewQuote, receivedAt: number, elapsed: number): CounterState {
  if (state.phase === 'pending') throw new Error('Resolve the pending submission before reviewing.');
  quote = quoteSchema.parse(quote);
  if (JSON.stringify(quote.lines.map(line => ({ productId: line.productId, qty: line.qty })).sort((a, b) => a.productId.localeCompare(b.productId))) !== JSON.stringify(state.items)) throw new Error('Review does not match the saved cart.');
  const deadline = receivedAt + Math.max(0, Date.parse(quote.validUntil) - Date.parse(quote.quotedAt) - elapsed);
  return { items: state.items, customerId: state.customerId, serving: state.serving, revision: state.revision, phase: 'review', quote, deadline };
}
export function prepareSubmission(state: CounterState, now: number, idempotencyKey: string): CounterState {
  if (state.phase === 'pending') return state;
  if (state.phase !== 'review' || now >= state.deadline) throw new Error('Review this cart again before confirming.');
  return { items: state.items, customerId: state.customerId, serving: state.serving, revision: state.revision, phase: 'pending', quote: state.quote, request: { items: state.items, ...(state.customerId ? { customerId: state.customerId } : {}), serving: state.serving, quoteId: state.quote.id, priceVersion: state.quote.priceVersion, idempotencyKey } };
}
export function refuseSubmission(state: CounterState, reason: string): CounterState {
  return { items: state.items, customerId: state.customerId, serving: state.serving, revision: state.revision, phase: 'draft', reason };
}
export interface CounterJournal { load(scope: string): Promise<CounterState>; save(scope: string, state: CounterState): Promise<CounterState> }
// IndexedDB commits before submission. CAS prevents an older browser tab overwriting a pending key.
export function counterJournal(): CounterJournal {
  let opening: Promise<IDBDatabase> | undefined;
  function database() {
    return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('bitpos-counter-v2', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Durable cart storage unavailable; no order was sent.'));
    });
  }
  return {
    async load(scope) {
      const db = await database();
      return new Promise<CounterState>((resolve, reject) => {
        const transaction = db.transaction('workspace', 'readonly');
        const request = transaction.objectStore('workspace').get(scope);
        request.onsuccess = () => {
          try { resolve(restoreCounter(request.result)); } catch { reject(new Error('Durable journal invalid. Do not replace an unresolved order; staff recovery is required.')); }
        };
        request.onerror = () => reject(new Error('Unable to restore durable cart.'));
      });
    },
    async save(scope, state) {
      const db = await database();
      return new Promise<CounterState>((resolve, reject) => {
        const transaction = db.transaction('workspace', 'readwrite');
        const store = transaction.objectStore('workspace');
        const read = store.get(scope);
        const next = { ...state, revision: state.revision + 1 };
        let conflict = false;
        read.onsuccess = () => {
          try {
            if (restoreCounter(read.result).revision !== state.revision) { conflict = true; transaction.abort(); return; }
            store.put(stateSchema.parse(next), scope);
          } catch { transaction.abort(); }
        };
        transaction.oncomplete = () => resolve(next);
        transaction.onabort = transaction.onerror = () => reject(new Error(conflict ? 'This register draft changed in another tab. Reload the workspace; nothing was sent.' : 'Durable cart save failed; no order was sent.'));
      });
    },
  };
}
