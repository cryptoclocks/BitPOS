import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/presentation/driver_rides_page.dart';

const id = '00000000-0000-4000-8000-000000000061';
const account = '00000000-0000-4000-8000-000000000062';
MobileRideTrip trip(String state) => MobileRideTrip.fromJson({
  'id': id,
  'state': state,
  'seats': 2,
  'shared': true,
  'fare': {'currency': 'THB', 'decimals': 2, 'amountMinor': '7505'},
  'distanceMetres': 5000,
  'durationSeconds': 600,
  'pickup': {'latitudeE7': 137560000, 'longitudeE7': 1005018000},
  'dropoff': {'latitudeE7': 137600000, 'longitudeE7': 1005100000},
  'version': '1',
  'riderAccountId': account,
  'driverAccountId': state == 'REQUESTED' ? null : account,
});

class Fake {
  MobileRideTrip? current;
  List<MobileRideTrip> open = [];
  final calls = <String>[];
  Object? failNext;
  Future<T> _go<T>(String name, T Function() ok) async {
    calls.add(name);
    final e = failNext;
    if (e != null) {
      failNext = null;
      throw e;
    }
    return ok();
  }

  DriverRideGateway get gateway => DriverRideGateway(
    current: () => _go('current', () => MobileRideCurrent(trip: current)),
    open: () => _go('open', () => MobileRideOpen(trips: open)),
    accept: (_) => _go('accept', () {
      open = [];
      return current = trip('MATCHED');
    }),
    arrive: (_) => _go('arrive', () => current = trip('ARRIVED')),
    start: (_, pin) => _go('start:$pin', () => current = trip('IN_TRIP')),
    complete: (_) => _go('complete', () {
      current = null;
      return trip('COMPLETED');
    }),
    cancel: (_) => _go('cancel', () {
      current = null;
      return trip('CANCELLED');
    }),
    location: (_) => _go(
      'location',
      () => MobileRideLocation(
        enabled: false,
        point: null,
        receivedAt: null,
        expiresAt: null,
      ),
    ),
    consentLocation: (_, enabled) => _go(
      'location-consent:$enabled',
      () => MobileRideLocationConsent(enabled: enabled),
    ),
    sendLocation: (_, point) => _go(
      'location-send:${point.latitudeE7}',
      () => MobileRideLocationConsent(enabled: true),
    ),
    positions: () async => Stream<MobileRidePoint>.value(
      MobileRidePoint(latitudeE7: 137570000, longitudeE7: 1005020000),
    ),
  );
}

Future<void> pump(WidgetTester tester, Fake fake, {bool thai = false}) async {
  tester.view.physicalSize = const Size(800, 1800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: DriverRidesPage(gateway: fake.gateway, thai: thai),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('rideMoney formats minor units without floating point', () {
    MobileMoney m(String a, int d, [String c = 'THB']) =>
        MobileMoney(currency: c, decimals: d, amountMinor: a);
    expect(rideMoney(m('7505', 2)), '75.05 THB');
    expect(rideMoney(m('5', 2)), '0.05 THB');
    expect(rideMoney(m('1234567', 6, 'USDG')), '1.234567 USDG');
  });

  testWidgets(
    'empty state, then open request is accepted and the job walks to completion',
    (tester) async {
      final fake = Fake();
      await pump(tester, fake);
      expect(find.byKey(const ValueKey('ride-empty')), findsOneWidget);
      fake.open = [trip('REQUESTED')];
      await tester.tap(find.byKey(const ValueKey('ride-refresh')));
      await tester.pumpAndSettle();
      expect(find.text('75.05 THB'), findsOneWidget);
      expect(find.textContaining('No payment or earning'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('ride-accept.$id')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('ride-arrive')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('ride-arrive')));
      await tester.pumpAndSettle();
      final start = find.byKey(const ValueKey('ride-start'));
      expect(
        tester.widget<FilledButton>(start).onPressed,
        isNull,
        reason: 'a PIN is required',
      );
      await tester.enterText(
        find.byKey(const ValueKey('ride-pin-field')),
        '12',
      );
      await tester.pump();
      expect(
        tester.widget<FilledButton>(start).onPressed,
        isNull,
        reason: 'four digits only',
      );
      await tester.enterText(
        find.byKey(const ValueKey('ride-pin-field')),
        '4821',
      );
      await tester.pump();
      await tester.tap(start);
      await tester.pumpAndSettle();
      expect(fake.calls, contains('start:4821'));
      expect(find.byKey(const ValueKey('ride-complete')), findsOneWidget);
      expect(
        find.byKey(const ValueKey('ride-cancel')),
        findsNothing,
        reason: 'no cancel while the trip is in progress',
      );
      final complete = find.byKey(const ValueKey('ride-complete'));
      await tester.ensureVisible(complete);
      await tester.pumpAndSettle();
      await tester.tap(complete);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('ride-empty')), findsOneWidget);
    },
  );

  testWidgets(
    'wrong and locked PIN, busy and conflict errors are explained; cancel is offered before the trip starts',
    (tester) async {
      final fake = Fake()..current = trip('ARRIVED');
      await pump(tester, fake);
      await tester.enterText(
        find.byKey(const ValueKey('ride-pin-field')),
        '0000',
      );
      await tester.pump();
      fake.failNext = const MobileApiException('PIN_INVALID', 409);
      await tester.tap(find.byKey(const ValueKey('ride-start')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Wrong PIN'), findsOneWidget);
      fake.failNext = const MobileApiException('PIN_LOCKED', 423);
      await tester.tap(find.byKey(const ValueKey('ride-start')));
      await tester.pumpAndSettle();
      expect(find.textContaining('PIN locked'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('ride-cancel')));
      await tester.pumpAndSettle();
      expect(fake.calls, contains('cancel'));
      expect(find.byKey(const ValueKey('ride-empty')), findsOneWidget);
    },
  );

  testWidgets('load failure shows a reason and Thai copy renders', (
    tester,
  ) async {
    final fake = Fake()
      ..failNext = const MobileApiException('DRIVER_NOT_APPROVED', 403);
    await pump(tester, fake, thai: true);
    expect(find.byKey(const ValueKey('ride-error')), findsOneWidget);
    expect(find.textContaining('ยังไม่ได้รับอนุมัติ'), findsOneWidget);
    expect(find.text('งานผู้โดยสาร'), findsOneWidget);
  });

  testWidgets(
    'location requires explicit per-trip opt-in and stops before completion',
    (tester) async {
      final fake = Fake()..current = trip('IN_TRIP');
      await pump(tester, fake);
      final toggle = find.byKey(const ValueKey('ride-location-sharing'));
      expect(tester.widget<SwitchListTile>(toggle).value, false);
      await tester.tap(toggle);
      await tester.pumpAndSettle();
      expect(fake.calls, contains('location-consent:true'));
      expect(fake.calls, contains('location-send:137570000'));
      expect(tester.widget<SwitchListTile>(toggle).value, true);
      final complete = find.byKey(const ValueKey('ride-complete'));
      final completion = tester.widget<FilledButton>(complete).onPressed;
      expect(completion, isNotNull);
      await tester.runAsync(() async {
        final result = (completion as dynamic)();
        if (result is Future<void>) await result;
      });
      await tester.pumpAndSettle();
      expect(
        fake.calls.indexOf('location-consent:false'),
        lessThan(fake.calls.indexOf('complete')),
        reason: '${fake.calls}',
      );
    },
  );
}
