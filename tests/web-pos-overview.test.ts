import assert from 'node:assert/strict';
import test from 'node:test';
import { channelOf, hourlyBuckets, isToday, sumSingleDenomination } from '../apps/web/src/lib/pos-overview';
import type { PrivateOrder } from '../apps/web/src/lib/table';

const order = (total: object, createdAt: string, serving = 'counter'): PrivateOrder => ({ id: 'o', status: 'PAID', pricing: { kind: 'versioned', priceVersion: 'v', lines: [], total }, authority: { serving: { kind: serving } }, createdAt } as unknown as PrivateOrder);
const usd = (amountMinor: string) => ({ currency: 'USD', decimals: 2, amountMinor });

test('sales are summed only inside one denomination', () => {
  assert.deepEqual(sumSingleDenomination([order(usd('100'), '2026-10-26T10:00:00'), order(usd('250'), '2026-10-26T11:00:00')]), usd('350'));
  assert.equal(sumSingleDenomination([order(usd('100'), 'x'), order({ currency: 'USDG', decimals: 6, amountMinor: '5' }, 'x')]), 'mixed');
  assert.equal(sumSingleDenomination([]), null);
});
test('channel and today derive from server fields only', () => {
  assert.equal(channelOf(order(usd('1'), 'x', 'delivery')), 'delivery');
  assert.equal(channelOf(order(usd('1'), 'x', 'takeaway')), 'pickup');
  assert.equal(channelOf(order(usd('1'), 'x', 'table')), 'store');
  assert.equal(isToday(order(usd('1'), '2026-10-26T01:00:00'), new Date('2026-10-26T20:00:00')), true);
  assert.equal(isToday(order(usd('1'), '2026-10-25T23:00:00'), new Date('2026-10-26T20:00:00')), false);
});
test('hour buckets stay inside the day', () => {
  const buckets = hourlyBuckets([order(usd('1'), '2026-10-26T20:15:00'), order(usd('1'), '2026-10-26T20:45:00')]);
  assert.ok(buckets.every(b => b.hour >= 0 && b.hour <= 23));
  assert.equal(buckets.find(b => b.hour === 20)?.count, 2);
});
