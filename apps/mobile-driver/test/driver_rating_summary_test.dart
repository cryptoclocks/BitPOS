import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/driver_rating_summary.dart';

import 'driver_earnings_surface_test.dart' show EarningsApi, first;

class RatingApi extends EarningsApi {
  int? average = 43;
  String count = '4';
  bool fail = false;
  int reads = 0;
  Completer<DriverReviewSummary>? delayed;
  @override
  Future<DriverReviewSummary> driverReviewSummary() async {
    reads++;
    if (fail) throw StateError('unavailable');
    return delayed?.future ??
        DriverReviewSummary(
          driverId: first,
          publishedCount: count,
          averageTenths: average,
          snapshotAt: DateTime.now().toUtc().toIso8601String(),
        );
  }
}

void main() {
  Future<void> mount(WidgetTester tester, RatingApi api) async {
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(body: DriverRatingSummary(api: api, thai: false)),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'actual tenths and published count render then owner loss hides facts',
    (tester) async {
      final api = RatingApi();
      await mount(tester, api);
      expect(find.text('4.3'), findsOneWidget);
      expect(find.text('From 4 published reviews'), findsOneWidget);
      api.change(null);
      await tester.pump();
      expect(find.text('4.3'), findsNothing);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets('no ratings and unavailable have distinct truthful states', (
    tester,
  ) async {
    final api = RatingApi()
      ..average = null
      ..count = '0';
    await mount(tester, api);
    expect(find.text('No published ratings yet'), findsOneWidget);
    expect(find.text('0.0'), findsNothing);
    api.fail = true;
    await tester.tap(find.text('Refresh rating'));
    await tester.pumpAndSettle();
    expect(find.text('Rating unavailable'), findsOneWidget);
    expect(find.text('No published ratings yet'), findsNothing);
    await tester.pumpWidget(const MaterialApp());
  });
  testWidgets(
    'foreground-only rating expires without request loop and rejects delayed owner result',
    (tester) async {
      final api = RatingApi();
      await mount(tester, api);
      await tester.pump(const Duration(minutes: 5, seconds: 1));
      expect(find.text('4.3'), findsNothing);
      expect(api.reads, 1);
      final held = Completer<DriverReviewSummary>();
      api.delayed = held;
      await tester.tap(find.text('Refresh rating'));
      await tester.pump();
      api.change(null);
      held.complete(
        DriverReviewSummary(
          driverId: first,
          publishedCount: '4',
          averageTenths: 43,
          snapshotAt: DateTime.now().toUtc().toIso8601String(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('4.3'), findsNothing);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets(
    'background hides rating and resume reloads current published facts',
    (tester) async {
      final api = RatingApi()
        ..count = '1'
        ..average = 40;
      await mount(tester, api);
      expect(find.text('From 1 published review'), findsOneWidget);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.scheduleForcedFrame();
      await tester.pump();
      expect(find.text('4.0'), findsNothing);
      api.average = 50;
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.text('5.0'), findsOneWidget);
      expect(api.reads, 2);
      await tester.pumpWidget(const MaterialApp());
    },
  );
}
