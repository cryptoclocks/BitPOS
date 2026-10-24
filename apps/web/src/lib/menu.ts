import type { Money } from '../../../../packages/contracts/src/index';
import type { ScopedPromotionLine } from '../../../../packages/contracts/src/promotions';
import type {DailyPromotionLine} from '../../../../packages/contracts/src/daily-promotions';
import type {PersonalPromotionLine} from '../../../../packages/contracts/src/personal-promotions';
import { parsePrice } from './money';
export type Discount = { kind: 'amount'; amountMinor: string } | { kind: 'percent'; percent: number };
export interface Promotion { priceVersion: string; revision: string; expiresAt: string; discount: Discount }
export interface Product { id: string; name: string; nameEn: string; imageUrl: string | null; category: string; description: string; unitPrice: Money | null; basePrice: Money | null; promotion: Promotion | null; scopedPromotion?: ScopedPromotionLine; dailyPromotion?:DailyPromotionLine;personalPromotion?:PersonalPromotionLine; available: number }
export interface Menu {bundles?:import('../../../../packages/contracts/src/bundle-promotions').BundleOffer[]; products: Product[]; merchant: { name: string }; asOf: string; priceValidUntil: string; menuVersion: string; priceVersion: string | null; pricingRevision: string; currency: 'USD' | 'USDG' | null; decimals: 2 | 4 | 6 | null }
export interface Offer { priceVersion: string; revision: string; enabled: boolean; basePriceMinor: string; currentPriceMinor: string; expiresAt: string; discount: Discount }
export interface OfferView { productId: string; priceVersion: string; asOf: string; offer: Offer | null; active: boolean; effective: Pick<Product, 'basePrice' | 'unitPrice' | 'promotion'> }
export interface OfferDraft { kind: Discount['kind']; value: string; expiresAt: string }
export function canEditOffers(role: string): boolean { return role === 'owner' || role === 'manager'; }
export function discountFromDraft(draft: OfferDraft, currency: 'USD' | 'USDG', decimals:2|4|6=currency==='USD'?2:6): Discount {
  if (draft.kind === 'amount') return { kind: 'amount', amountMinor: parsePrice(draft.value, currency,decimals) };
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
  if (!base || (base.currency !== 'USD' && base.currency !== 'USDG')) throw new Error('Configure an active USD/USDG price version first.');
  const discount = discountFromDraft(draft, base.currency,base.decimals);
  const expiry = Date.parse(draft.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now) throw new Error('Choose a future offer expiry.');
  return { priceVersion: view.priceVersion, expectedRevision: view.offer?.revision ?? '0', enabled: true as const, basePriceMinor: base.amountMinor, currentPriceMinor: discountedMinor(base.amountMinor, discount), expiresAt: new Date(expiry).toISOString(), discount };
}
export function displayProduct(product: Product, valid: boolean, asOf: string): Product {
  const promotion = product.promotion;
  const scoped = product.scopedPromotion??product.personalPromotion??product.dailyPromotion;
  if (valid && scoped && !promotion && (!product.dailyPromotion||Date.parse(product.dailyPromotion.startsAt)<=Date.parse(asOf)) && product.basePrice && product.unitPrice && Date.parse(scoped.expiresAt) > Date.parse(asOf)) {
    try { if (discountedMinor(product.basePrice.amountMinor, { kind: 'percent', percent: scoped.discountPercent }) === product.unitPrice.amountMinor) return product; } catch { /* An invalid scoped offer is never advertised. */ }
  }
  if (valid && promotion && product.basePrice && product.unitPrice && Date.parse(promotion.expiresAt) > Date.parse(asOf)) {
    try { if (discountedMinor(product.basePrice.amountMinor, promotion.discount) === product.unitPrice.amountMinor) return product; } catch { /* Invalid promotion is never advertised. */ }
  }
  return { ...product, unitPrice: product.basePrice, promotion: null, scopedPromotion: undefined,dailyPromotion:undefined,personalPromotion:undefined };
}
export function menuLease(menu: Menu, startedAt: number): number {
  const duration = Math.min(60_000, Date.parse(menu.priceValidUntil) - Date.parse(menu.asOf), ...menu.products.flatMap(p => [p.promotion?.expiresAt, p.scopedPromotion?.expiresAt,p.dailyPromotion?.expiresAt,p.personalPromotion?.expiresAt].filter((value): value is string => !!value).map(expiry => Date.parse(expiry) - Date.parse(menu.asOf))));
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
