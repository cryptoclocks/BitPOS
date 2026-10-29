import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWeek, isOpenAt, normaliseWeek, validTimeZone } from '../packages/domain/src/opening-hours';

test('normalise sorts windows and rejects overlap, overnight, bad clocks, unknown days and too many windows', () => {
  const week = normaliseWeek({ '1': [{ opens: '13:00', closes: '18:00' }, { opens: '08:00', closes: '12:00' }] });
  assert.deepEqual(week['1'], [{ opens: '08:00', closes: '12:00' }, { opens: '13:00', closes: '18:00' }]);
  assert.deepEqual(week['0'], []);
  for (const bad of [
    { '1': [{ opens: '08:00', closes: '12:00' }, { opens: '11:00', closes: '14:00' }] },
    { '1': [{ opens: '22:00', closes: '02:00' }] },
    { '1': [{ opens: '8:00', closes: '12:00' }] },
    { '1': [{ opens: '08:00', closes: '24:00' }] },
    { '7': [] },
    { '1': Array.from({ length: 5 }, (_, i) => ({ opens: `0${i}:00`, closes: `0${i}:30` })) },
    { '1': [{ opens: '08:00', closes: '12:00', extra: 1 }] },
    [],
    null,
  ]) assert.throws(() => normaliseWeek(bad), /INVALID_HOURS/);
});
test('isOpenAt uses the merchant zone, half-open windows and weekday 0 = Sunday', () => {
  const week = { ...emptyWeek(), '1': [{ opens: '08:00', closes: '18:00' }] };
  // Monday 2026-10-26 08:00 Bangkok = 01:00 UTC
  assert.equal(isOpenAt(week, 'Asia/Bangkok', new Date('2026-10-26T01:00:00Z')), true);
  assert.equal(isOpenAt(week, 'Asia/Bangkok', new Date('2026-10-26T00:59:00Z')), false);
  assert.equal(isOpenAt(week, 'Asia/Bangkok', new Date('2026-10-26T11:00:00Z')), false); // 18:00 closes exclusive
  assert.equal(isOpenAt(week, 'UTC', new Date('2026-10-26T01:00:00Z')), false); // same instant is 01:00 in UTC
  assert.equal(isOpenAt(week, 'Asia/Bangkok', new Date('2026-10-25T05:00:00Z')), false); // Sunday
});
test('time zones are validated', () => {
  assert.equal(validTimeZone('Asia/Bangkok'), true);
  assert.equal(validTimeZone('Not/AZone'), false);
  assert.equal(validTimeZone(''), false);
});
