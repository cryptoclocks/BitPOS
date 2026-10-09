import type { Money } from '../../../../packages/contracts/src/index';
import { parsePrice } from './money';
export type Discount = { kind: 'amount'; amountMinor: string } | { kind: 'percent'; percent: number };
export interface Promotion { priceVersion: string; revision: string; expiresAt: string; discount: Discount }
export interface Product { id: string; name: string; nameEn: string; imageUrl: string | null; category: string; description: string; unitPrice: Money | null; basePrice: Money | null; promotion: Promotion | null; available: number }
export interface Menu { products: Product[]; merchant: { name: string }; asOf: string; priceValidUntil: string; menuVersion: string; priceVersion: string | null; pricingRevision: string; currency: 'USD' | 'USDG' | null; decimals: 2 | 6 | null }
export interface Offer { priceVersion: string; revision: string; enabled: boolean; basePriceMinor: string; currentPriceMinor: string; expiresAt: string; discount: Discount }
export interface OfferView { productId: string; priceVersion: string; asOf: string; offer: Offer | null; active: boolean; effective: Pick<Product, 'basePrice' | 'unitPrice' | 'promotion'> }
export interface OfferDraft { kind: Discount['kind']; value: string; expiresAt: string }
export function canEditOffers(role: string): boolean { return role === 'owner' || role === 'manager'; }
export function discountFromDraft(draft: OfferDraft, currency: 'USD' | 'USDG'): Discount {
  if (draft.kind === 'amount') return { kind: 'amount', amountMinor: parsePrice(draft.value, currency) };
  if (!/^\d+$/.test(draft.value) || Number(draft.value) < 1 || Number(draft.value) > 99) throw new Error('Use a whole percent from 1 to 99.');
  return { kind: 'percent', percent: Number(draft.value) };
}
export function discountedMinor(basePriceMinor: string, discount: Discount): string {
  const base = BigInt(basePriceMinor);
  const reduction = discount.kind === 'amount' ? BigInt(discount.amountMinor) : base * BigInt(discount.percent) / 100n;
  if (reduction <= 0n || reduction >= base) throw new Error('Discount must reduce the price and leave a positive current price.');
  return (base - reduction).toString();
}
export function offerCommand(view: OfferView, draft: OfferDraft, now: number) {
  const base = view.effective.basePrice;
  if (!base || base.currency === 'THB') throw new Error('Configure an active USD/USDG price version first.');
  const discount = discountFromDraft(draft, base.currency);
  const expiry = Date.parse(draft.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error('Choose a future offer expiry.');
  return { priceVersion: view.priceVersion, expectedRevision: view.offer?.revision ?? '0', enabled: true as const, basePriceMinor: base.amountMinor, currentPriceMinor: discountedMinor(base.amountMinor, discount), expiresAt: new Date(expiry).toISOString(), discount };
}
export function displayProduct(product: Product, valid: boolean, asOf: string): Product {
  const promotion = product.promotion;
  if (valid && promotion && product.basePrice && product.unitPrice && Date.parse(promotion.expiresAt) > Date.parse(asOf)) {
    try { if (discountedMinor(product.basePrice.amountMinor, promotion.discount) === product.unitPrice.amountMinor) return product; } catch { /* Invalid promotion is never advertised. */ }
  }
  return { ...product, unitPrice: product.basePrice, promotion: null };
}
export function menuLease(menu: Menu, startedAt: number): number {
  const duration = Math.min(60_000, Date.parse(menu.priceValidUntil) - Date.parse(menu.asOf), ...menu.products.filter(p => p.promotion).map(p => Date.parse(p.promotion!.expiresAt) - Date.parse(menu.asOf)));
  return startedAt + (Number.isFinite(duration) ? Math.max(0, duration) : 0);
}
interface Clock { now(): number; set(run: () => void, delay: number): unknown; clear(timer: unknown): void }
const browserClock: Clock = { now: () => performance.now(), set: (run, delay) => window.setTimeout(run, delay), clear: timer => window.clearTimeout(timer as number) };
export interface MenuWatcher { refresh(): Promise<void>; stop(): void }
// One request in flight, one lease timer, bounded retry. Refresh never owns cart/order state.
export function watchMenu(load: () => Promise<Menu>, publish: (menu: Menu, valid: boolean) => void, failure: (error: unknown) => void, clock: Clock = browserClock): MenuWatcher {
  let active = true; let inFlight = false; let pending = false; let leaseTimer: unknown; let retryTimer: unknown;
  function retry() { clock.clear(retryTimer); retryTimer = clock.set(() => { void refresh(); }, 5000); }
  async function refresh(): Promise<void> {
    if (!active) return;
    if (inFlight) { pending = true; return; }
    inFlight = true; clock.clear(retryTimer);
    const startedAt = clock.now();
    try {
      const menu = await load();
      if (!active) return;
      clock.clear(leaseTimer);
      const delay = menuLease(menu, startedAt) - clock.now();
      publish(menu, delay > 0);
      if (delay > 0) leaseTimer = clock.set(() => { publish(menu, false); void refresh(); }, delay);
      else retry();
    } catch (error) { if (active) { failure(error); retry(); } }
    finally { inFlight = false; if (active && pending) { pending = false; void refresh(); } }
  }
  void refresh();
  return { refresh, stop() { active = false; clock.clear(leaseTimer); clock.clear(retryTimer); } };
}
