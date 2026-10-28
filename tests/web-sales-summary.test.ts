import test from 'node:test';
import assert from 'node:assert/strict';
import {hourlySales,netSales,salesSummary} from '../apps/web/src/lib/sales-summary';

const row = (sourceKind: string, orders: number, totalMinor: string, currency = 'USD', decimals = 2) => ({ currency, decimals, sourceKind, orders, totalMinor });

test('summarises one currency in integer minor units with channel shares', () => {
  const s = salesSummary([row('register', 6, '60000'), row('online', 2, '20000'), row('register', 2, '20000')])!;
  assert.equal(s.totalMinor, 100000n);assert.equal(s.orders, 10);assert.equal(s.averageMinor, 10000n);
  assert.deepEqual(s.channels.map(c => [c.kind, c.orders, c.share]), [['register', 8, 80], ['online', 2, 20]]);
});

test('never adds across currencies or precisions', () => {
  assert.equal(salesSummary([row('register', 1, '100'), row('register', 1, '100', 'THB')]), null);
  assert.equal(salesSummary([row('register', 1, '100'), row('register', 1, '10000', 'USD', 4)]), null);
  assert.equal(salesSummary([]), null);
});

test('rounds the average down and survives a zero total', () => {
  assert.equal(salesSummary([row('register', 3, '100')])!.averageMinor, 33n);
  const zero = salesSummary([row('register', 0, '0')])!;
  assert.equal(zero.averageMinor, 0n);assert.equal(zero.channels[0].share, 0);
});

test('large amounts stay exact (bigint, no float)', () => {
  const s = salesSummary([row('register', 1, '900000000000000001'), row('online', 1, '1')])!;
  assert.equal(s.totalMinor, 900000000000000002n);assert.equal(s.channels[0].kind, 'register');
});

test('hourly buckets keep one denomination and net subtracts finalized refunds only in that denomination', () => {
  const hours = [{ hour: 9, currency: 'USD', decimals: 2, orders: 2, totalMinor: '3000' }, { hour: 9, currency: 'THB', decimals: 2, orders: 1, totalMinor: '9900' }, { hour: 23, currency: 'USD', decimals: 2, orders: 1, totalMinor: '500' }];
  const buckets = hourlySales(hours, 'USD', 2);
  assert.equal(buckets.length, 24);assert.deepEqual([buckets[9].orders, buckets[9].totalMinor, buckets[23].totalMinor, buckets[0].orders], [2, 3000n, 500n, 0]);
  const summary = { currency: 'USD', decimals: 2, totalMinor: 3500n };
  assert.deepEqual(netSales(summary, []), { refundedMinor: 0n, cases: 0, netMinor: 3500n });
  assert.deepEqual(netSales(summary, [{ currency: 'USD', decimals: 2, cases: 3, refundedMinor: '1170' }]), { refundedMinor: 1170n, cases: 3, netMinor: 2330n });
  assert.equal(netSales(summary, [{ currency: 'THB', decimals: 2, cases: 1, refundedMinor: '100' }]), null);
});
