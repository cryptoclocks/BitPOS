import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { acceptReview, counterScope, editDraft, emptyDraft, prepareSubmission, refuseSubmission, restoreCounter, setQuantity, type CounterState } from '../apps/web/src/lib/counter';
import { parsePrice, formatMoney, lineTotal } from '../apps/web/src/lib/money';
import { ApiError, api } from '../apps/web/src/lib/api';
import OrderBill from '../apps/web/src/components/OrderBill';
import type { ReviewQuote } from '../apps/web/src/lib/table';
import type { OrderView } from '../packages/contracts/src/index';
const quote: ReviewQuote = {
  id: 'quote-fixture', priceVersion: 'price-fixture', pricingRevision: '2', cartVersion: null,
  lines: [{ productId: 'coffee', name: 'กาแฟ', nameEn: 'Coffee', qty: 2, priceVersion: 'price-fixture', basePrice: { currency: 'USD', decimals: 2, amountMinor: '270' }, unitPrice: { currency: 'USD', decimals: 2, amountMinor: '230' }, promotion: null }],
  total: { currency: 'USD', decimals: 2, amountMinor: '460' },
  settlement: { currency: 'USDG', decimals: 6, amountMinor: '4600000', network: 'solana:devnet', mint: 'fixture-mint', tokenProgram: 'fixture-program', genesisHash: 'fixture-genesis', testToken: true, recipient: 'fixture-recipient', sponsor: 'merchant_funded' },
  quotedAt: '2026-10-08T10:00:00Z', validUntil: '2026-10-08T10:01:00Z', authority: { kind: 'versioned', source: { kind: 'register', registerId: 'r', label: 'Counter A' }, serving: { kind: 'table', tableId: 't4', label: 'Table 4' }, target: { deviceId: 'a', assignmentGeneration: '9007199254740997' }, pairingGeneration: '9007199254740998' }, pairingGeneration: '9007199254740998', targetOnline: true, targetBusy: false,
};
const draft = setQuantity({ ...emptyDraft, serving: { kind: 'table', tableId: 't4' } }, 'coffee', 2);

test('owner prices parse exact USD2/USDG6 without exponent, rounding, zero or settlement overflow', () => {
  assert.equal(parsePrice('9007199254.740993', 'USDG'), '9007199254740993');
  assert.equal(parsePrice('12.3', 'USD'), '1230'); assert.equal(parsePrice('0.000001', 'USDG'), '1');
  for (const input of ['', '-1', '1e2', ' 1 ', '1.001', '0', '0.00', '1000000000000.00']) assert.throws(() => parsePrice(input, 'USD'));
  for (const input of ['1.0000001', '1000000000000']) assert.throws(() => parsePrice(input, 'USDG'));
});
test('review has a conservative server-relative deadline; edits invalidate confirmation without losing customer/serving', () => {
  const reviewed = acceptReview({ ...draft, customerId: 'returning-customer' }, quote, 300, 200);
  const changed = setQuantity(reviewed, 'coffee', 3);
  assert.equal(changed.phase, 'draft'); assert.equal(changed.customerId, 'returning-customer'); assert.deepEqual(changed.serving, { kind: 'table', tableId: 't4' });
  assert.throws(() => prepareSubmission(changed, 400, 'key'), /Review/);
  assert.throws(() => prepareSubmission(reviewed, 60100, 'key'), /Review/);
  assert.throws(() => acceptReview(draft, { ...quote, lines: [{ ...quote.lines[0], qty: 1 }] }, 300, 0), /match/);
});
test('ambiguous submit restores exact original key/quote/cart and cannot edit, review or replace key after reload', () => {
  const pending = prepareSubmission(acceptReview(draft, quote, 0, 0), 100, 'original-key');
  const restored = restoreCounter(JSON.parse(JSON.stringify(pending)));
  assert.equal(restored.phase, 'pending');
  if (restored.phase !== 'pending') throw new Error('Pending lost');
  assert.deepEqual(restored.request, { items: [{ productId: 'coffee', qty: 2 }], serving: { kind: 'table', tableId: 't4' }, quoteId: 'quote-fixture', priceVersion: 'price-fixture', idempotencyKey: 'original-key' });
  assert.equal('customerId' in restored.request, false, 'Guest does not create or demand a contact');
  assert.deepEqual(prepareSubmission(restored, 999999, 'replacement-key'), restored);
  assert.throws(() => editDraft(restored, { customerId: 'other' }), /Resolve/); assert.throws(() => setQuantity(restored, 'coffee', 1), /Resolve/); assert.throws(() => acceptReview(restored, quote, 0, 0), /Resolve/);
  assert.throws(() => restoreCounter({ ...restored, request: { ...restored.request, quoteId: 'different' } }), /Corrupt/);
});
test('busy/offline/stale definite refusal keeps quantities/contact/serving but requires a fresh review and explicit new confirm', () => {
  for (const code of ['DEVICE_BUSY', 'DEVICE_OFFLINE', 'PRICE_VERSION_CHANGED', 'PAIRING_CHANGED', 'QUOTE_EXPIRED']) {
    const pending = prepareSubmission(acceptReview({ ...draft, customerId: 'customer-id' }, quote, 0, 0), 100, 'key');
    const retained = refuseSubmission(pending, code);
    assert.deepEqual(retained.items, draft.items); assert.equal(retained.customerId, 'customer-id'); assert.deepEqual(retained.serving, draft.serving);
    assert.throws(() => prepareSubmission(retained, 101, 'replacement'), /Review/);
  }
  assert.equal(restoreCounter(acceptReview(draft, quote, 0, 0)).phase, 'draft', 'Reload cannot inherit confirmation');
});
test('journal scope isolates merchant, actor and register; 50 lines and quantity 100 are fully supported', () => {
  const actor = { token: 'never-persist', merchantId: 'merchant-a', userId: 'actor-a', role: 'staff' };
  const scope = counterScope(actor, 'register-a'); assert.ok(!scope.includes(actor.token));
  assert.notEqual(scope, counterScope({ ...actor, userId: 'actor-b' }, 'register-a')); assert.notEqual(scope, counterScope({ ...actor, merchantId: 'merchant-b' }, 'register-a')); assert.notEqual(scope, counterScope(actor, 'register-b'));
  let state: CounterState = { ...emptyDraft }; for (let index = 0; index < 50; index++) state = setQuantity(state, `product-${index}`, 100);
  assert.equal(state.items.length, 50); assert.throws(() => setQuantity(state, 'overflow', 1), /50/); assert.throws(() => setQuantity(state, 'product-0', 101), /100/);
  assert.equal(setQuantity(state, 'product-0', 0).items.length, 49);
});
test('frozen bill shows full lines/unit/total and immutable legacy THB with devnet trust, not current USD relabels', () => {
  const order: OrderView = { id: 'order-fixture', status: 'AWAITING_WALLET', version: 1, payer: null, authority: quote.authority, pricing: { kind: 'versioned', priceVersion: quote.priceVersion, lines: quote.lines, total: quote.total }, settlement: quote.settlement, quoteExpiresAt: quote.validUntil, paymentUrl: 'https://shop.invalid/pay/exact' };
  const html = renderToStaticMarkup(createElement(OrderBill, { order }));
  for (const required of ['USD 2.30', 'USD 4.60', 'USDG 4.600000', 'Table 4', 'Counter A', 'fixture-mint', 'fixture-genesis', 'fixture-program', 'fixture-recipient', 'Merchant-funded']) assert.ok(html.includes(required), required);
  assert.equal(formatMoney(lineTotal(quote.lines[0])), 'USD 4.60');
  const legacy: OrderView = { ...order, authority: { kind: 'legacy', source: { kind: 'legacy_counter', label: 'Legacy counter' }, serving: { kind: 'legacy_unknown', label: 'Unknown historical serving' }, target: { legacyTerminalId: 'terminal-1' } }, pricing: { kind: 'legacy_thb', lines: [{ ...quote.lines[0], unitPrice: { currency: 'THB', decimals: 2, amountMinor: '9500' } }], total: { currency: 'THB', decimals: 2, amountMinor: '19000' } } };
  const old = renderToStaticMarkup(createElement(OrderBill, { order: legacy })); assert.ok(old.includes('THB 190.00')); assert.ok(old.includes('THB 95.00')); assert.ok(!old.includes('USD 190.00')); assert.ok(!old.includes('Table 4'));
});
test('HTTP structured refusals expose codes while transport/service errors never imply definite rejection', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: { code: 'DEVICE_BUSY', message: 'Target is in use', retryable: true } }, { status: 409 });
    await assert.rejects(api('/registers/r/orders', {}, 'session'), error => error instanceof ApiError && error.code === 'DEVICE_BUSY' && error.definiteRefusal);
    globalThis.fetch = async () => Response.json({ error: 'Service unavailable' }, { status: 502 });
    await assert.rejects(api('/registers/r/orders', {}), error => error instanceof ApiError && !error.definiteRefusal);
    globalThis.fetch = async () => { throw new TypeError('Connection lost after commit'); };
    await assert.rejects(api('/registers/r/orders', {}), TypeError);
  } finally { globalThis.fetch = original; }
});
