import test from 'node:test';
import assert from 'node:assert/strict';
import { perDenomination, toMinor } from '../apps/web/src/lib/shift-view';

test('typed amounts become integer minor units without floating point', () => {
  assert.equal(toMinor('5200', 2), '520000');
  assert.equal(toMinor('5,200.5', 2), '520050');
  assert.equal(toMinor('0.07', 2), '7');
  assert.equal(toMinor(' 12. ', 2), '1200');
  assert.equal(toMinor('1', 0), '1');
  assert.equal(toMinor('0.1', 6), '100000');
});

test('anything that is not a plain amount within the precision is refused', () => {
  for (const bad of ['', '-1', '1.234', '1e3', 'abc', '1.2.3', '１２', '9999999999999999']) assert.equal(toMinor(bad, 2), null, bad);
  assert.equal(toMinor('1.5', 0), null, 'no fractional digits allowed at zero decimals');
});

test('totals are kept per currency and precision, never added across', () => {
  const rows = perDenomination([{ currency: 'USD', decimals: 2, orders: 2, totalMinor: '1000' }, { currency: 'USD', decimals: 2, orders: 1, totalMinor: '500' }, { currency: 'THB', decimals: 2, orders: 1, totalMinor: '9900' }, { currency: 'USD', decimals: 6, orders: 1, totalMinor: '5' }]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.find(r => r.currency === 'USD' && r.decimals === 2), { currency: 'USD', decimals: 2, orders: 3, totalMinor: 1500n });
});
