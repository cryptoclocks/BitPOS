import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/ride_request_page.dart';

const tripId = '00000000-0000-4000-8000-000000000071';
const account = '00000000-0000-4000-8000-000000000072';
MobileAddress address(String id, String label, int? lat, int? lng) =>
    MobileAddress.fromJson({
      'id': id,
      'version': '1',
      'address': {
        'label': label,
        'recipientName': 'R',
        'phone': '+66900000001',
        'addressText': '$label street',
        'instructions': '',
        'latitudeE7': lat,
        'longitudeE7': lng,
      },
      'archived': false,
      'updatedAt': '2026-10-27T00:00:00Z',
    });
MobileRideTrip trip(String state) => MobileRideTrip.fromJson({
  'id': tripId,
  'state': state,
  'seats': 1,
  'shared': false,
  'fare': {'currency': 'THB', 'decimals': 2, 'amountMinor': '7500'},
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
  List<MobileAddress> addresses = [
    address(
      '00000000-0000-4000-8000-0000000000a1',
      'Home',
      137560000,
      1005018000,
    ),
    address(
      '00000000-0000-4000-8000-0000000000a2',
      'Office',
      137600000,
      1005100000,
    ),
    address('00000000-0000-4000-8000-0000000000a3', 'No pin', null, null),
  ];
  final calls = <String>[];
  MobileRideQuoteRequest? quoted;
  MobileRideRequest? requested;
  Object? failNext;
  Future<T> go<T>(String n, T Function() ok) async {
    calls.add(n);
    final e = failNext;
    if (e != null) {
      failNext = null;
      throw e;
    }
    return ok();
  }

  RiderRideGateway get gateway => RiderRideGateway(
    addresses: () => go('addresses', () => addresses),
    current: () => go('current', () => MobileRideCurrent(trip: current)),
    quote: (q) => go('quote', () {
      quoted = q;
      return MobileRideQuote(
        rateId: tripId,
        fare: MobileMoney(currency: 'THB', decimals: 2, amountMinor: '7500'),
        seats: q.seats,
        shared: q.shared,
      );
    }),
    request: (r) => go('request', () {
      requested = r;
      current = trip('REQUESTED');
      return MobileRideRequested(trip: current!, pin: '4821');
    }),
    cancel: (_) => go('cancel', () {
      current = null;
      return trip('CANCELLED');
    }),
    share: (_) => go(
      'share',
      () => MobileRideShare(
        token: 'abcdefghijklmnopqrstuvwx',
        expiresAt: '2026-10-27T06:00:00Z',
      ),
    ),
    revoke: (_) => go('revoke', () => MobileRideShareRevoked(revoked: 1)),
    report: (id, kind, body) => go(
      'report:$kind:$body',
      () => MobileRideIncidentReceipt(
        id: tripId,
        kind: kind,
        createdAt: '2026-10-27T00:00:00Z',
      ),
    ),
    location: (_) => go(
      'location',
      () => MobileRideLocation(
        enabled: true,
        point: MobileRidePoint(latitudeE7: 137570000, longitudeE7: 1005020000),
        receivedAt: '2026-10-27T00:00:00Z',
        expiresAt: '2026-10-27T00:01:00Z',
      ),
    ),
  );
}

class FixtureRouteProvider implements RideRouteProvider {
  int calls = 0;
  @override
  Future<RideEstimate> estimate(
    MobileRidePoint pickup,
    MobileRidePoint dropoff,
  ) async {
    calls++;
    return const RideEstimate(4321, 765);
  }
}

Future<void> pump(WidgetTester tester, Fake fake, {bool thai = false}) async {
  await tester.pumpWidget(
    MaterialApp(
      home: RideRequestPage(
        gateway: fake.gateway,
        thai: thai,
        pollInterval: null,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('estimate is straight-line x1.3 at 25 km/h with bounds, and keys are v4 uuids', () {
    final e = RideEstimate.between(
      MobileRidePoint(latitudeE7: 137560000, longitudeE7: 1005018000),
      MobileRidePoint(latitudeE7: 137560000, longitudeE7: 1005018000),
    );
    expect(e.distanceMetres, 100, reason: 'never below the 100 m floor');
    expect(e.durationSeconds, 60);
    final far = RideEstimate.between(
      MobileRidePoint(latitudeE7: 137560000, longitudeE7: 1005018000),
      MobileRidePoint(latitudeE7: 138560000, longitudeE7: 1005018000),
    );
    expect(far.distanceMetres, closeTo(11119.5 * 1.3, 100));
    expect(
      far.durationSeconds,
      closeTo(far.distanceMetres / (25000 / 3600), 1),
    );
    expect(
      newRideKey(math.Random(1)),
      matches(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ),
      ),
    );
    expect(
      rideMoneyText(
        MobileMoney(currency: 'THB', decimals: 2, amountMinor: '5'),
      ),
      '0.05 THB',
    );
  });

  testWidgets(
    'needs two pinned addresses; quote then request shows the PIN once; cancel returns to the form',
    (tester) async {
      final fake = Fake()
        ..addresses = [
          address(
            '00000000-0000-4000-8000-0000000000a1',
            'Home',
            137560000,
            1005018000,
          ),
        ];
      await pump(tester, fake);
      expect(find.byKey(const ValueKey('ride-need-addresses')), findsOneWidget);
      fake.addresses = [
        address(
          '00000000-0000-4000-8000-0000000000a1',
          'Home',
          137560000,
          1005018000,
        ),
        address(
          '00000000-0000-4000-8000-0000000000a2',
          'Office',
          137600000,
          1005100000,
        ),
        address('00000000-0000-4000-8000-0000000000a3', 'No pin', null, null),
      ];
      await tester.tap(find.byKey(const ValueKey('ride-refresh')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('ride-from')));
      await tester.pumpAndSettle();
      expect(
        find.text('No pin'),
        findsNothing,
        reason: 'addresses without a map pin are not offered',
      );
      await tester.tap(find.text('Home').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('ride-to')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Office').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('ride-seats-plus')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('ride-shared')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('ride-quote')));
      await tester.pumpAndSettle();
      expect(fake.quoted!.seats, 2);
      expect(fake.quoted!.shared, true);
      expect(find.text('75.00 THB'), findsOneWidget);
      expect(find.textContaining('No payment is taken'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('ride-request')));
      await tester.pumpAndSettle();
      expect(fake.requested!.distanceMetres, fake.quoted!.distanceMetres);
      expect(find.byKey(const ValueKey('ride-pin')), findsOneWidget);
      expect(find.text('4821'), findsOneWidget);
      expect(find.text('Looking for a driver'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('ride-cancel')));
      await tester.pumpAndSettle();
      expect(fake.calls, contains('cancel'));
      expect(find.byKey(const ValueKey('ride-quote')), findsOneWidget);
    },
  );

  testWidgets(
    'a matched trip without the PIN says so; share shows a token, revoke clears it; report sends kind and text; no cancel in trip',
    (tester) async {
      final fake = Fake()..current = trip('MATCHED');
      await pump(tester, fake);
      expect(find.byKey(const ValueKey('ride-pin-lost')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('ride-share')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('ride-share-token')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('ride-revoke')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('ride-share-token')), findsNothing);
      await tester.tap(find.byKey(const ValueKey('ride-report')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('ride-incident-text')),
        'Unsafe driving',
      );
      await tester.tap(find.byKey(const ValueKey('ride-incident-send')));
      await tester.pumpAndSettle();
      expect(fake.calls, contains('report:SAFETY:Unsafe driving'));
      fake.current = trip('IN_TRIP');
      await tester.tap(find.byKey(const ValueKey('ride-refresh')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('ride-cancel')), findsNothing);
      expect(
        find.byKey(const ValueKey('ride-driver-location')),
        findsOneWidget,
      );
      expect(find.textContaining('13.75700'), findsOneWidget);
    },
  );

  testWidgets('fares unpublished is explained, and Thai renders', (
    tester,
  ) async {
    final fake = Fake()
      ..failNext = const MobileApiException('FARES_UNPUBLISHED', 409);
    await pump(tester, fake, thai: true);
    expect(find.byKey(const ValueKey('ride-error')), findsOneWidget);
    expect(find.text('เรียกรถ'), findsOneWidget);
  });

  testWidgets(
    'an injected route provider supplies the canonical quote inputs',
    (tester) async {
      final fake = Fake(), provider = FixtureRouteProvider();
      await tester.pumpWidget(
        MaterialApp(
          home: RideRequestPage(
            gateway: fake.gateway,
            thai: false,
            pollInterval: null,
            routeProvider: provider,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('ride-from')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Home').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('ride-to')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Office').last);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('ride-quote')));
      await tester.pumpAndSettle();
      expect(provider.calls, 1);
      expect(fake.quoted!.distanceMetres, 4321);
      expect(fake.quoted!.durationSeconds, 765);
    },
  );
}
