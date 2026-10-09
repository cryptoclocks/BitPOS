import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditOffers, discountedMinor, displayProduct, menuLease, offerCommand, watchMenu, type Menu, type OfferView, type Product } from '../apps/web/src/lib/menu';
import { parsePrice } from '../apps/web/src/lib/money';

const product: Product = { id: 'product-1', name: 'กาแฟ', nameEn: 'Coffee', imageUrl: null, category: '', description: '', available: 10, basePrice: { currency: 'USD', decimals: 2, amountMinor: '5001' }, unitPrice: { currency: 'USD', decimals: 2, amountMinor: '4251' }, promotion: { priceVersion: 'version-a', revision: '8', expiresAt: '2026-10-08T10:00:10Z', discount: { kind: 'percent', percent: 15 } } };
const menu: Menu = { products: [product], merchant: { name: 'Test fixture shop' }, asOf: '2026-10-08T10:00:00Z', priceValidUntil: '2026-10-08T10:00:10Z', menuVersion: 'menu-a', priceVersion: 'version-a', pricingRevision: '1', currency: 'USD', decimals: 2 };
const view: OfferView = { productId: product.id, priceVersion: 'version-a', asOf: menu.asOf, offer: null, active: false, effective: { basePrice: product.basePrice, unitPrice: product.basePrice, promotion: null } };
function fakeClock() {
  let time = 0; let id = 0;
  const timers = new Map<number, { at: number; run(): void }>();
  return {
    now: () => time,
    set(run: () => void, delay: number) { timers.set(++id, { at: time + delay, run }); return id; },
    clear(timer: unknown) { timers.delete(timer as number); },
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); time = next[1].at; next[1].run();
      }
      time = end;
    },
    get timers() { return timers.size; },
  };
}
async function drain() { for (let i = 0; i < 4; i++) await Promise.resolve(); }

test('amount and whole-percent editor commands retain exact minor units and expected revision', () => {
  assert.equal(parsePrice('9007199254.740993', 'USDG'), '9007199254740993');
  assert.equal(discountedMinor('5001', { kind: 'percent', percent: 15 }), '4251');
  const draft = { kind: 'percent' as const, value: '15', expiresAt: '2026-10-08T11:00:00Z' };
  assert.deepEqual(offerCommand(view, draft, Date.parse(menu.asOf)), { priceVersion: 'version-a', expectedRevision: '0', enabled: true, basePriceMinor: '5001', currentPriceMinor: '4251', expiresAt: '2026-10-08T11:00:00.000Z', discount: { kind: 'percent', percent: 15 } });
  const existing: OfferView = { ...view, offer: { priceVersion: 'version-a', revision: '9007199254740999', enabled: false, basePriceMinor: '5001', currentPriceMinor: '4001', expiresAt: draft.expiresAt, discount: { kind: 'amount', amountMinor: '1000' } } };
  assert.deepEqual(offerCommand(existing, { ...draft, kind: 'amount', value: '10.00' }, Date.parse(menu.asOf)), { priceVersion: 'version-a', expectedRevision: '9007199254740999', enabled: true, basePriceMinor: '5001', currentPriceMinor: '4001', expiresAt: '2026-10-08T11:00:00.000Z', discount: { kind: 'amount', amountMinor: '1000' } });
});
test('editor refuses fractional percent, zero/free discounts, invalid USD and expired dates', () => {
  for (const value of ['0', '100', '1.5', '-1']) assert.throws(() => offerCommand(view, { kind: 'percent', value, expiresAt: '2026-10-08T11:00:00Z' }, Date.parse(menu.asOf)), /whole percent/);
  for (const value of ['0', '50.01', '100']) assert.throws(() => offerCommand(view, { kind: 'amount', value, expiresAt: '2026-10-08T11:00:00Z' }, Date.parse(menu.asOf)));
  for (const value of ['1.001', '-1', '1e2', '']) assert.throws(() => parsePrice(value, 'USD'), /USD amount/);
  for (const expiresAt of ['bad', menu.asOf]) assert.throws(() => offerCommand(view, { kind: 'amount', value: '1', expiresAt }, Date.parse(menu.asOf)), /future offer expiry/);
});
test('only owner/manager edit offers; stale, mismatched and absent promotions are plain currency-tagged prices', () => {
  assert.equal(canEditOffers('owner'), true); assert.equal(canEditOffers('manager'), true);
  for (const role of ['staff', 'customer', '']) assert.equal(canEditOffers(role), false);
  assert.deepEqual(displayProduct(product, true, menu.asOf), product);
  for (const candidate of [product, { ...product, unitPrice: { currency: 'USD' as const, decimals: 2 as const, amountMinor: '1' } }, { ...product, promotion: null }]) {
    const shown = displayProduct(candidate, false, menu.asOf); assert.equal(shown.unitPrice!.amountMinor, '5001'); assert.equal(shown.promotion, null);
  }
  assert.equal(displayProduct({ ...product, unitPrice: { currency: 'USD', decimals: 2, amountMinor: '4000' } }, true, menu.asOf).promotion, null);
  assert.equal(displayProduct(product, true, product.promotion!.expiresAt).unitPrice!.amountMinor, '5001');
  assert.equal(displayProduct({ ...product, unitPrice: product.basePrice, promotion: null }, true, menu.asOf).promotion, null);
});
test('lease is relative to server asOf, capped at sixty seconds and earliest offer expiry', () => {
  assert.equal(menuLease(menu, 300), 10300);
  assert.equal(menuLease({ ...menu, products: [], priceValidUntil: '2026-10-08T11:00:00Z' }, 300), 60300);
  assert.equal(menuLease({ ...menu, priceValidUntil: '2026-10-08T10:01:00Z' }, 300), 10300);
  assert.equal(menuLease({ ...menu, asOf: 'invalid' }, 300), 300);
});
test('lease expiry hides discounted price and badge before refresh', async () => {
  const clock = fakeClock(); let calls = 0; let resolve: (value: Menu) => void = () => { throw new Error('No request'); };
  let shown: Product[] = []; const validity: boolean[] = [];
  const watcher = watchMenu(() => { calls++; return calls === 1 ? Promise.resolve(menu) : new Promise<Menu>(done => { resolve = done; }); }, (next, valid) => { validity.push(valid); shown = next.products.map(p => displayProduct(p, valid, next.asOf)); }, error => { throw error; }, clock);
  await drain(); assert.equal(shown[0].unitPrice!.amountMinor, '4251'); assert.equal(calls, 1);
  clock.advance(10000); assert.equal(calls, 2); assert.equal(shown[0].unitPrice!.amountMinor, '5001'); assert.equal(shown[0].promotion, null);
  resolve({ ...menu, asOf: '2026-10-08T10:00:10Z', priceValidUntil: '2026-10-08T10:01:10Z', products: [{ ...product, unitPrice: product.basePrice, promotion: null }] });
  await drain(); assert.deepEqual(validity, [true, false, true]); assert.equal(shown[0].promotion, null); watcher.stop(); assert.equal(clock.timers, 0);
});
test('already-expired responses and failures retry after five seconds, never a zero-delay loop', async () => {
  const clock = fakeClock(); let calls = 0; const validity: boolean[] = []; const errors: unknown[] = [];
  const watcher = watchMenu(async () => { calls++; if (calls === 2) throw new Error('Offline'); return { ...menu, priceValidUntil: menu.asOf }; }, (_, valid) => validity.push(valid), error => errors.push(error), clock);
  await drain(); assert.equal(calls, 1); assert.deepEqual(validity, [false]);
  clock.advance(4999); await drain(); assert.equal(calls, 1);
  clock.advance(1); await drain(); assert.equal(calls, 2); assert.equal(errors.length, 1);
  clock.advance(5000); await drain(); assert.equal(calls, 3); assert.deepEqual(validity, [false, false]); watcher.stop();
});
test('slow responses do not extend a lease, refreshes coalesce and stopped sessions ignore late results', async () => {
  const clock = fakeClock(); let calls = 0; const published: boolean[] = []; const resolvers: ((menu: Menu) => void)[] = [];
  const watcher = watchMenu(() => { calls++; return new Promise<Menu>(resolve => resolvers.push(resolve)); }, (_, valid) => published.push(valid), error => { throw error; }, clock);
  await watcher.refresh(); await watcher.refresh(); assert.equal(calls, 1);
  clock.advance(9000); resolvers[0](menu); await drain(); assert.equal(calls, 2); assert.deepEqual(published, [true]);
  clock.advance(1000); assert.deepEqual(published, [true, false]); assert.equal(calls, 2);
  watcher.stop(); resolvers[1](menu); await drain(); assert.equal(calls, 2); assert.deepEqual(published, [true, false]); assert.equal(clock.timers, 0);
});
