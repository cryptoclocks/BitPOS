import 'package:bitpos_customer/presentation/schedule_slot_picker.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

MobileScheduleSlot _slot(String startUtc, String endUtc, {String tz = 'Asia/Bangkok'}) => MobileScheduleSlot(
  id: '11111111-1111-4111-8111-111111111111',
  startsAt: startUtc,
  endsAt: endUtc,
  bookingClosesAt: '2026-10-30T16:30:00Z',
  timezone: tz,
);

void main() {
  // 2026-10-30 18:00 UTC is already 31 Oct 01:00 in Bangkok.
  final lateUtc = _slot('2026-10-30T18:00:00Z', '2026-10-30T18:30:00Z');
  test('shop day, not UTC day, decides Today and the printed clock time', () {
    final nowBangkokNextDay = DateTime.parse('2026-10-30T18:10:00Z'); // 31 Oct 01:10 Bangkok
    expect(ScheduleSlotTile.format(lateUtc, false, now: nowBangkokNextDay), 'Today 01:00–01:30');
    expect(ScheduleSlotTile.format(lateUtc, true, now: nowBangkokNextDay), 'วันนี้ 01:00–01:30');
  });
  test('a slot 31 Oct Bangkok is not Today while Bangkok is still on 30 Oct', () {
    final now = DateTime.parse('2026-10-30T05:00:00Z'); // 30 Oct 12:00 Bangkok
    expect(ScheduleSlotTile.format(lateUtc, false, now: now), '31/10 01:00–01:30');
  });
  test('UTC slot labelled Today on the UTC date of a night order is corrected', () {
    final now = DateTime.parse('2026-10-30T20:00:00Z'); // 31 Oct 03:00 Bangkok
    final slot = _slot('2026-10-30T23:00:00Z', '2026-10-30T23:30:00Z'); // 31 Oct 06:00 Bangkok
    expect(ScheduleSlotTile.format(slot, false, now: now), 'Today 06:00–06:30');
  });
  test('booking deadline is shown in shop time', () {
    expect(ScheduleSlotTile.clock('2026-10-30T16:30:00Z'), '23:30');
  });
}
