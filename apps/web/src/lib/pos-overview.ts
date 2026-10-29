import type { PrivateOrder } from './table';

type Money = PrivateOrder['pricing']['total'];
export type Channel = 'store' | 'delivery' | 'pickup';

// Presentation derived only from the orders the server already returned. Nothing
// here is a settlement, fee or comparison figure: totals are summed only inside
// one denomination, and facts the API does not provide are stated as unavailable.
export function sumSingleDenomination(orders: PrivateOrder[]): Money | 'mixed' | null {
  let total: bigint | undefined; let first: Money | undefined;
  for (const order of orders) {
    const money = order.pricing.total;
    if (!first) first = money;
    else if (first.currency !== money.currency || first.decimals !== money.decimals) return 'mixed';
    total = (total ?? 0n) + BigInt(money.amountMinor);
  }
  return first ? { ...first, amountMinor: (total ?? 0n).toString() } as Money : null;
}
export function channelOf(order: PrivateOrder): Channel {
  const kind = order.authority.serving.kind;
  if (kind === 'delivery') return 'delivery';
  if (kind === 'pickup' || kind === 'takeaway') return 'pickup';
  return 'store';
}
/** The shop's time zone. Asia/Bangkok is the only zone the contract allows, so "today" and hours never follow the browser's zone. */
export const SHOP_TIME_ZONE = 'Asia/Bangkok';
/** The orders list endpoint returns at most this many newest orders (apps/api/src/orders.ts LIMIT 200). */
export const ORDER_LIST_CAP = 200;
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: SHOP_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });
export const shopDay = (at: Date): string => dayFormat.format(at);
export const shopHour = (at: Date): number => Number(hourFormat.format(at));
/** HH:mm in the shop's zone. */
export function shopTime(iso: string, language: 'th' | 'en'): string {
  return new Date(iso).toLocaleTimeString(language === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: SHOP_TIME_ZONE });
}
export function isToday(order: PrivateOrder, now: Date): boolean {
  if (!order.createdAt) return false;
  return shopDay(new Date(order.createdAt)) === shopDay(now);
}
/** True when the capped list may have dropped orders from today (the oldest returned order is itself from today). */
export function todayMayBeTruncated(orders: PrivateOrder[], now: Date): boolean {
  if (orders.length < ORDER_LIST_CAP) return false;
  const times = orders.filter(o => o.createdAt).map(o => Date.parse(o.createdAt!));
  return !!times.length && shopDay(new Date(Math.min(...times))) === shopDay(now);
}
/** Paid-order counts per shop hour, windowed to at least six hours that include every non-empty hour. */
export function bucketsFromCounts(counts: ReadonlyMap<number, number>): { hour: number; count: number }[] {
  const hours = [...counts.entries()].filter(([, n]) => n > 0).map(([h]) => h);
  if (!hours.length) return [];
  const last = Math.max(...hours), from = Math.max(0, Math.min(Math.min(...hours), 23 - 5)), to = Math.max(from + 5, last);
  return Array.from({ length: Math.min(24 - from, to - from + 1) }, (_, index) => ({ hour: from + index, count: counts.get(from + index) ?? 0 }));
}
export function hourlyBuckets(orders: PrivateOrder[]): { hour: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const order of orders) if (order.createdAt) { const hour = shopHour(new Date(order.createdAt)); counts.set(hour, (counts.get(hour) ?? 0) + 1); }
  return bucketsFromCounts(counts);
}

/** Wire shape of GET /api/overview/summary (apps/api/src/overview-summary.ts). Sales: paid time; order count and channels: created time. */
export interface OverviewSummaryWire {
  day: string; timeZone: string; generatedAt: string;
  orders: { today: number; paid: number; inProgress: number };
  sales: { currency: string; decimals: number; orders: number; totalMinor: string }[] | null;
  excludedOrders: number | null;
  channels: Record<Channel, number>;
  hours: { hour: number; paid: number }[];
  recent: { id: string; channel: Channel; status: string; fulfillmentStatus: string | null; total: Money; createdAt: string }[];
}
export type SalesFigure =
  | { kind: 'none' } // nothing paid yet
  | { kind: 'hidden' } // this role may not read money totals
  | { kind: 'mixed' } // capped client fallback only: orders in several denominations
  | { kind: 'money'; items: Money[] }; // one entry per denomination, never summed together
export interface OverviewRecentRow { id: string; channel: Channel; status: string; fulfillmentStatus: string | null; total: Money; createdAt: string }
export interface OverviewView {
  source: 'server' | 'orders';
  todayCount: number; paidCount: number; inProgress: number;
  sales: SalesFigure; excludedOrders: number;
  channels: Record<Channel, number>;
  buckets: { hour: number; count: number }[];
  recent: OverviewRecentRow[];
}
const inProgressOrder = (order: PrivateOrder) => order.status === 'PAID' && !!order.fulfillment && order.fulfillment.status !== 'COLLECTED';
export function viewFromSummary(summary: OverviewSummaryWire): OverviewView {
  return {
    source: 'server', todayCount: summary.orders.today, paidCount: summary.orders.paid, inProgress: summary.orders.inProgress,
    sales: summary.sales === null ? { kind: 'hidden' } : summary.sales.length ? { kind: 'money', items: summary.sales.map(s => ({ currency: s.currency, decimals: s.decimals, amountMinor: s.totalMinor }) as Money) } : { kind: 'none' },
    excludedOrders: summary.excludedOrders ?? 0, channels: summary.channels,
    buckets: bucketsFromCounts(new Map(summary.hours.map(h => [h.hour, h.paid]))),
    recent: summary.recent,
  };
}
/** Fallback derived from the (capped) order list: used only when the summary endpoint is unavailable. */
export function viewFromOrders(orders: PrivateOrder[], now: Date): OverviewView {
  const today = orders.filter(order => isToday(order, now)), paid = today.filter(order => order.status === 'PAID');
  const sales = sumSingleDenomination(paid);
  const channels: Record<Channel, number> = { store: 0, delivery: 0, pickup: 0 };
  for (const order of today) channels[channelOf(order)]++;
  return {
    source: 'orders', todayCount: today.length, paidCount: paid.length, inProgress: today.filter(inProgressOrder).length,
    sales: sales === null ? { kind: 'none' } : sales === 'mixed' ? { kind: 'mixed' } : { kind: 'money', items: [sales] }, excludedOrders: 0, channels,
    buckets: hourlyBuckets(paid),
    recent: [...today].sort((a, b) => Date.parse(b.createdAt!) - Date.parse(a.createdAt!)).slice(0, 5)
      .map(order => ({ id: order.id, channel: channelOf(order), status: order.status, fulfillmentStatus: order.status === 'PAID' ? (order.fulfillment?.status ?? null) : null, total: order.pricing.total, createdAt: order.createdAt! })),
  };
}
