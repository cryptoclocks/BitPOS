import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketsFromCounts, viewFromOrders, viewFromSummary, channelOf, hourlyBuckets, isToday, shopDay, shopHour, shopTime, sumSingleDenomination, todayMayBeTruncated, ORDER_LIST_CAP } from '../apps/web/src/lib/pos-overview';
import type { PrivateOrder } from '../apps/web/src/lib/table';

const order = (total: object, createdAt: string, serving = 'counter'): PrivateOrder => ({ id: 'o', status: 'PAID', pricing: { kind: 'versioned', priceVersion: 'v', lines: [], total }, authority: { serving: { kind: serving } }, createdAt } as unknown as PrivateOrder);
const usd = (amountMinor: string) => ({ currency: 'USD', decimals: 2, amountMinor });

test('sales are summed only inside one denomination', () => {
  assert.deepEqual(sumSingleDenomination([order(usd('100'), '2026-10-26T10:00:00+07:00'), order(usd('250'), '2026-10-26T11:00:00+07:00')]), usd('350'));
  assert.equal(sumSingleDenomination([order(usd('100'), 'x'), order({ currency: 'USDG', decimals: 6, amountMinor: '5' }, 'x')]), 'mixed');
  assert.equal(sumSingleDenomination([]), null);
});
test('channel and today derive from server fields only', () => {
  assert.equal(channelOf(order(usd('1'), 'x', 'delivery')), 'delivery');
  assert.equal(channelOf(order(usd('1'), 'x', 'takeaway')), 'pickup');
  assert.equal(channelOf(order(usd('1'), 'x', 'table')), 'store');
  assert.equal(isToday(order(usd('1'), '2026-10-26T01:00:00+07:00'), new Date('2026-10-26T20:00:00+07:00')), true);
  assert.equal(isToday(order(usd('1'), '2026-10-25T23:00:00+07:00'), new Date('2026-10-26T20:00:00+07:00')), false);
});
test('hour buckets stay inside the day', () => {
  const buckets = hourlyBuckets([order(usd('1'), '2026-10-26T20:15:00+07:00'), order(usd('1'), '2026-10-26T20:45:00+07:00')]);
  assert.ok(buckets.every(b => b.hour >= 0 && b.hour <= 23));
  assert.equal(buckets.find(b => b.hour === 20)?.count, 2);
});

// The shop is in Asia/Bangkok; none of these may depend on the process or browser time zone (run the suite with TZ=America/New_York too).
test('days and hours follow Asia/Bangkok around local midnight', () => {
  const justBefore = '2026-10-25T16:50:00Z', justAfter = '2026-10-25T17:10:00Z'; // 23:50 on the 25th and 00:10 on the 26th in Bangkok
  assert.equal(shopDay(new Date(justBefore)), '2026-10-25');
  assert.equal(shopDay(new Date(justAfter)), '2026-10-26');
  const now = new Date('2026-10-26T05:00:00Z'); // 12:00 on the 26th in Bangkok
  assert.equal(isToday(order(usd('1'), justBefore), now), false);
  assert.equal(isToday(order(usd('1'), justAfter), now), true);
  assert.equal(shopHour(new Date(justAfter)), 0);
  assert.equal(shopHour(new Date(justBefore)), 23);
  assert.equal(hourlyBuckets([order(usd('1'), justAfter)]).find(b => b.count === 1)?.hour, 0);
  assert.equal(shopTime(justAfter, 'en'), '00:10');
});
test('a possibly truncated list is flagged only when the oldest returned order is from today', () => {
  const now = new Date('2026-10-26T05:00:00Z');
  const many = (iso: string) => Array.from({ length: ORDER_LIST_CAP }, () => order(usd('1'), iso));
  assert.equal(todayMayBeTruncated(many('2026-10-26T02:00:00Z'), now), true);
  assert.equal(todayMayBeTruncated(many('2026-10-24T02:00:00Z'), now), false);
  assert.equal(todayMayBeTruncated(many('2026-10-26T02:00:00Z').slice(1), now), false);
});

test('server summary view keeps denominations apart and windows the hours', () => {
  const view = viewFromSummary({
    day: '2026-10-30', timeZone: 'Asia/Bangkok', generatedAt: 'x', orders: { today: 234, paid: 231, inProgress: 191 },
    sales: [{ currency: 'THB', decimals: 2, orders: 20, totalMinor: '20210' }, { currency: 'USD', decimals: 2, orders: 211, totalMinor: '56970' }], excludedOrders: 0,
    channels: { store: 222, delivery: 0, pickup: 12 }, hours: [{ hour: 0, paid: 16 }, { hour: 3, paid: 15 }], recent: [],
  });
  assert.equal(view.source, 'server'); assert.equal(view.todayCount, 234); assert.equal(view.paidCount, 231);
  assert.deepEqual(view.sales, { kind: 'money', items: [{ currency: 'THB', decimals: 2, amountMinor: '20210' }, { currency: 'USD', decimals: 2, amountMinor: '56970' }] });
  assert.deepEqual(view.buckets.map(b => b.hour), [0, 1, 2, 3, 4, 5]); assert.equal(view.buckets[3].count, 15); assert.equal(view.buckets[1].count, 0);
  assert.deepEqual(viewFromSummary({ ...{ day: '', timeZone: '', generatedAt: '', orders: { today: 0, paid: 0, inProgress: 0 }, excludedOrders: null, channels: { store: 0, delivery: 0, pickup: 0 }, hours: [], recent: [] }, sales: null }).sales, { kind: 'hidden' });
  assert.deepEqual(viewFromSummary({ day: '', timeZone: '', generatedAt: '', orders: { today: 0, paid: 0, inProgress: 0 }, sales: [], excludedOrders: 0, channels: { store: 0, delivery: 0, pickup: 0 }, hours: [], recent: [] }).sales, { kind: 'none' });
  assert.deepEqual(bucketsFromCounts(new Map()), []);
});
test('order-list fallback view is labelled as such and never merges denominations', () => {
  const mixed = viewFromOrders([order(usd('100'), '2026-10-26T10:00:00+07:00'), order({ currency: 'USDG', decimals: 6, amountMinor: '5' }, '2026-10-26T11:00:00+07:00')], new Date('2026-10-26T20:00:00+07:00'));
  assert.equal(mixed.source, 'orders'); assert.deepEqual(mixed.sales, { kind: 'mixed' }); assert.equal(mixed.todayCount, 2);
});
