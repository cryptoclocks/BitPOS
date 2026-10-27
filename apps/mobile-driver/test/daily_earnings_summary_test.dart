import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/daily_earnings_summary.dart';

import 'driver_earnings_surface_test.dart' show EarningsApi, second;

class SummaryApi extends EarningsApi {
  bool fail = false;
  Duration lease = const Duration(hours: 12);
  int reads = 0;
  Completer<DriverDailyEarnings>? delayed;
  @override
  Future<DriverDailyEarnings> driverDailyEarnings() async {
    reads++;
    if (fail) throw StateError('unavailable');
    return delayed?.future ??
        DriverDailyEarnings.fromJson({
          'timeZone': 'Asia/Bangkok',
          'dayStart': '2026-10-19T17:00:00Z',
          'dayEnd': DateTime.now().add(lease).toUtc().toIso8601String(),
          'snapshotAt': '2026-10-20T01:00:00Z',
          'completedDeliveries': '7',
          'isTransferTotal': false,
          'groups': [
            {
              'state': 'AVAILABLE',
              'count': '2',
              'money': {'amountMinor': '123', 'currency': 'USD', 'decimals': 2},
            },
            {
              'state': 'HELD',
              'count': '1',
              'money': {
                'amountMinor': '2000000',
                'currency': 'USDG',
                'decimals': 6,
              },
            },
          ],
        });
  }
}

void main() {
  testWidgets(
    'daily obligations retain currency and state, never claim transferred total',
    (tester) async {
      final api = SummaryApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DriverDailySummary(api: api, thai: false),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Eligible · 2 entries'), findsOneWidget);
      expect(find.text('Held for review · 1 entries'), findsOneWidget);
      expect(find.textContaining('Not today’s transfers.'), findsOneWidget);
      expect(find.text('7'), findsOneWidget);
      api.change((accountId: second, sessionId: second));
      await tester.pump();
      expect(find.text('7'), findsNothing);
      expect(find.textContaining('Eligible'), findsNothing);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets('failed summary is unavailable rather than zero balance', (
    tester,
  ) async {
    final api = SummaryApi()..fail = true;
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: DriverDailySummary(api: api, thai: false)),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Daily summary unavailable. Try again.'), findsOneWidget);
    expect(find.text('0'), findsNothing);
  });
  testWidgets(
    'day expiry hides old today values without automatic request loop',
    (tester) async {
      final api = SummaryApi()..lease = const Duration(seconds: 2);
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: DriverDailySummary(api: api, thai: false)),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('7'), findsOneWidget);
      await tester.pump(const Duration(seconds: 3));
      expect(find.text('7'), findsNothing);
      expect(
        find.text('Daily summary unavailable. Try again.'),
        findsOneWidget,
      );
      expect(api.reads, 1);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets('late daily response cannot reveal previous owner figures', (
    tester,
  ) async {
    final api = SummaryApi();
    final result = await api.driverDailyEarnings();
    final delayed = Completer<DriverDailyEarnings>();
    api.delayed = delayed;
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: DriverDailySummary(api: api, thai: false)),
      ),
    );
    await tester.pump();
    api.change((accountId: second, sessionId: second));
    delayed.complete(result);
    await tester.pumpAndSettle();
    expect(find.text('7'), findsNothing);
    expect(find.textContaining('Eligible'), findsNothing);
    await tester.pumpWidget(const MaterialApp());
  });
}
