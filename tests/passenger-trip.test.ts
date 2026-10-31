import assert from 'node:assert/strict';
import test from 'node:test';
import { canJoin, canTransition, checkPin, issuePin, issueShareToken, pinAttemptLimit, quoteFare, shareValid, terminal } from '../packages/domain/src/passenger-trip';

const rates = { currency: 'THB', decimals: 2, baseMinor: 3500n, perKmMinor: 600n, perMinuteMinor: 100n, minimumMinor: 5000n, sharedDiscountBps: 2500 };

test('fare is integer minor, floors per component, honours minimum and seats', () => {
  assert.equal(quoteFare(rates, { distanceMetres: 5000, durationSeconds: 600, seats: 1, shared: false }).totalMinor, 3500n + 3000n + 1000n);
  assert.equal(quoteFare(rates, { distanceMetres: 100, durationSeconds: 30, seats: 1, shared: false }).totalMinor, 5000n);
  assert.equal(quoteFare(rates, { distanceMetres: 5000, durationSeconds: 600, seats: 2, shared: false }).totalMinor, 15000n);
  const shared = quoteFare(rates, { distanceMetres: 5000, durationSeconds: 600, seats: 1, shared: true });
  assert.equal(shared.totalMinor, 5625n);
  assert.equal(typeof shared.totalMinor, 'bigint');
});

test('fare rejects out-of-range input', () => {
  for (const bad of [{ distanceMetres: 0, durationSeconds: 60, seats: 1 }, { distanceMetres: 1.5, durationSeconds: 60, seats: 1 }, { distanceMetres: 1000, durationSeconds: 60, seats: 7 }, { distanceMetres: 1000, durationSeconds: 60, seats: 0 }])
    assert.throws(() => quoteFare(rates, { ...bad, shared: false }), /INVALID_TRIP/);
  assert.throws(() => quoteFare({ ...rates, sharedDiscountBps: 9500 }, { distanceMetres: 1000, durationSeconds: 60, seats: 1, shared: true }), /INVALID_TRIP/);
});

test('state machine only moves forward; terminals are final', () => {
  assert.ok(canTransition('REQUESTED', 'MATCHED') && canTransition('ARRIVED', 'IN_TRIP') && canTransition('IN_TRIP', 'COMPLETED'));
  assert.ok(!canTransition('IN_TRIP', 'CANCELLED') && !canTransition('COMPLETED', 'IN_TRIP') && !canTransition('REQUESTED', 'IN_TRIP'));
  assert.ok(terminal('COMPLETED') && terminal('CANCELLED') && !terminal('MATCHED'));
});

test('arrival PIN: hash only, wrong attempts counted, locks at the limit even for the right value', () => {
  const { pin, record } = issuePin();
  assert.match(pin, /^\d{4}$/);
  assert.ok(!JSON.stringify(record).includes(`"${pin}"`));
  let state = record; const wrong = pin === '0000' ? '1111' : '0000';
  for (let i = 0; i < pinAttemptLimit; i++) { const r = checkPin(state, wrong); assert.equal(r.ok, false); state = r.record; }
  assert.deepEqual({ ...checkPin(state, pin) }, { ok: false, record: state, locked: true });
  assert.equal(checkPin(record, pin).ok, true);
  assert.equal(checkPin(record, 'abcd').ok, false);
});

test('shared occupancy fits capacity and never mixes exclusive with shared', () => {
  assert.ok(canJoin(4, [], 4, false, false));
  assert.ok(canJoin(4, [2], 2, true, true));
  assert.ok(!canJoin(4, [2], 3, true, true));
  assert.ok(!canJoin(4, [1], 1, false, true));
  assert.ok(!canJoin(4, [1], 1, true, false));
  assert.ok(!canJoin(4, [0], 1, true, true));
});

test('safety share token expires, can be revoked and is not stored in clear', () => {
  const now = 1_000_000, s = issueShareToken(now);
  assert.notEqual(s.hash, s.token);
  assert.ok(shareValid(s, s.token, now + 1000));
  assert.ok(!shareValid(s, s.token + 'x', now));
  assert.ok(!shareValid(s, s.token, s.expiresAt));
  assert.ok(!shareValid({ ...s, revoked: true }, s.token, now));
});
