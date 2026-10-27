import assert from 'node:assert/strict';
import test from 'node:test';
import { canBatch, join, lock, newGroup, removeLine, setLine, splitFee, splitParent, totalsByCurrency, maxGroupMembers } from '../packages/domain/src/group-cart';

const line = (memberId: string, merchantId: string, productId: string, qty: number, unitMinor: bigint, currency = 'THB', decimals = 2) => ({ merchantId, productId, memberId, qty, unitMinor, currency, decimals });

test('members edit only their own lines; owner can remove any; lock is owner-only and freezes edits', () => {
  let g = join(newGroup('g', 'o'), 'a');
  g = setLine(g, 'a', line('a', 'm1', 'p', 2, 1000n));
  assert.throws(() => setLine(g, 'o', line('a', 'm1', 'p', 1, 1000n)), /NOT_YOUR_LINE/);
  assert.throws(() => setLine(g, 'z', line('z', 'm1', 'p', 1, 1000n)), /NOT_YOUR_LINE/);
  assert.throws(() => removeLine(g, 'x', 'a', 'm1', 'p'), /NOT_YOUR_LINE/);
  assert.equal(removeLine(g, 'o', 'a', 'm1', 'p').lines.length, 0);
  assert.equal(setLine(g, 'a', line('a', 'm1', 'p', 0, 1000n)).lines.length, 0);
  assert.throws(() => lock(g, 'a'), /OWNER_ONLY/);
  assert.throws(() => lock(newGroup('g', 'o'), 'o'), /EMPTY_CART/);
  const locked = lock(g, 'o');
  assert.throws(() => setLine(locked, 'a', line('a', 'm1', 'p', 1, 1000n)), /GROUP_NOT_OPEN/);
  assert.throws(() => join(locked, 'b'), /GROUP_NOT_OPEN/);
});

test('group size is capped and rejoin is idempotent', () => {
  let g = newGroup('g', 'o');
  for (let i = 1; i < maxGroupMembers; i++) g = join(g, `m${i}`);
  assert.equal(join(g, 'm1'), g);
  assert.throws(() => join(g, 'extra'), /GROUP_FULL/);
});

test('parent splits into one child per merchant and currency; totals never cross denominations', () => {
  const kids = splitParent([line('a', 'm1', 'p1', 2, 1000n), line('b', 'm1', 'p2', 1, 500n), line('a', 'm2', 'p3', 1, 700n), line('a', 'm2', 'p4', 1, 5n, 'USDC', 6)]);
  assert.equal(kids.length, 3);
  const m1 = kids.find(k => k.merchantId === 'm1')!;
  assert.equal(m1.money.minor, 2500n); assert.deepEqual(m1.perMember, { a: 2000n, b: 500n });
  assert.deepEqual(totalsByCurrency(kids).map(t => [t.currency, t.minor]), [['THB', 3200n], ['USDC', 5n]]);
});

test('fee split is exact, deterministic and proportional', () => {
  const s = splitFee(1000n, { a: 1n, b: 1n, c: 1n });
  assert.equal(Object.values(s).reduce((x, y) => x + y, 0n), 1000n);
  assert.deepEqual(s, { a: 334n, b: 333n, c: 333n });
  assert.deepEqual(splitFee(100n, { a: 3n, b: 1n }), { a: 75n, b: 25n });
  assert.throws(() => splitFee(10n, {}), /INVALID_SPLIT/);
  assert.throws(() => splitFee(-1n, { a: 1n }), /INVALID_SPLIT/);
});

test('batching: same merchant and currency, ready close, drop close, capped', () => {
  const base = { merchantId: 'm1', currency: 'THB', dropLat: 13.75, dropLng: 100.5 };
  const anchor = { ...base, orderId: 'a', readyAtMs: 0 };
  const ok = { ...base, orderId: 'b', readyAtMs: 60_000 };
  const lateReady = { ...base, orderId: 'c', readyAtMs: 10 * 60_000 };
  const far = { ...base, orderId: 'd', readyAtMs: 0, dropLat: 13.95 };
  const other = { ...base, orderId: 'e', readyAtMs: 0, merchantId: 'm2' };
  const usd = { ...base, orderId: 'f', readyAtMs: 0, currency: 'USDC' };
  const two = { ...base, orderId: 'g', readyAtMs: 120_000 }, three = { ...base, orderId: 'h', readyAtMs: 180_000 };
  assert.deepEqual(canBatch(anchor, [lateReady, far, other, usd, anchor]).map(o => o.orderId), []);
  assert.deepEqual(canBatch(anchor, [ok, lateReady, far, other]).map(o => o.orderId), ['b']);
  assert.deepEqual(canBatch(anchor, [three, two, ok]).map(o => o.orderId), ['b', 'g']);
});

test('batching checks all pairs, rejects invalid coordinates and does not repeat an order', () => {
  const anchor = { orderId: 'a', merchantId: 'm', currency: 'USD', readyAtMs: 300000, dropLat: 0, dropLng: 0 };
  const west = { ...anchor, orderId: 'b', readyAtMs: 0, dropLng: -0.01 };
  const east = { ...anchor, orderId: 'c', readyAtMs: 600000, dropLng: 0.01 };
  const invalid = { ...anchor, orderId: 'd', dropLat: Number.NaN };
  assert.deepEqual(canBatch(anchor, [invalid, west, { ...west }, east]).map(c => c.orderId), ['b']);
  assert.deepEqual(canBatch({ ...anchor, dropLat: 91 }, [west]), []);
  assert.deepEqual(canBatch(anchor, [{ ...anchor, orderId: 'e', readyAtMs: Infinity }]), []);
});
