import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_driver/presentation/driver_home_metrics.dart';
import 'package:bitpos_driver/daily_earnings_summary.dart';
import 'package:bitpos_driver/driver_rating_summary.dart';

import 'daily_earnings_summary_test.dart' show SummaryApi;

import 'package:mobile_shared/mobile_v1.generated.dart';

import 'driver_earnings_surface_test.dart' show first;

class MetricsApi extends SummaryApi {
  @override
  Future<DriverReviewSummary> driverReviewSummary() async =>
      DriverReviewSummary(
        driverId: first,
        publishedCount: '4',
        averageTenths: 43,
        snapshotAt: DateTime.now().toUtc().toIso8601String(),
      );
}

void main() {
  for (final scenario in [
    (width: 390.0, scale: 1.0, columns: true),
    (width: 320.0, scale: 1.0, columns: false),
    (width: 390.0, scale: 1.5, columns: false),
  ]) {
    testWidgets(
      'home metrics responsive ${scenario.width}/${scenario.scale} preserves all financial states',
      (tester) async {
        tester.view.physicalSize = Size(scenario.width, 2000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final api = MetricsApi();
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(scenario.scale)),
              child: child!,
            ),
            home: Scaffold(
              body: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: DriverHomeMetrics(
                    earnings: DriverDailySummary(
                      api: api,
                      thai: true,
                      compact: true,
                    ),
                    rating: DriverRatingSummary(api: api, thai: true),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final left = tester.getRect(find.byType(DriverDailySummary)),
            right = tester.getRect(find.byType(DriverRatingSummary));
        if (scenario.columns) {
          expect(right.left - left.right, closeTo(14, .1));
          expect(right.top, left.top);
          expect(left.width, 164);
        } else {
          expect(right.top - left.bottom, closeTo(14, .1));
          expect(right.left, left.left);
        }
        expect(find.text('4.3'), findsOneWidget);
        expect(find.text('7'), findsOneWidget);
        expect(find.text('ผ่านเกณฑ์การจ่าย · 2 รายการ'), findsOneWidget);
        expect(find.text('รอตรวจสอบ · 1 รายการ'), findsOneWidget);
        await tester.ensureVisible(find.text('รายละเอียดรายได้'));
        await tester.tap(find.text('รายละเอียดรายได้'));
        await tester.pumpAndSettle();
        expect(
          find.textContaining('ไม่ใช่ยอดโอนวันนี้').hitTestable(),
          findsOneWidget,
        );
        expect(find.textContaining('ข้อมูล ณ').hitTestable(), findsOneWidget);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const MaterialApp());
      },
    );
  }
}
