import 'package:bitpos_driver/food_work_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:integration_test/integration_test.dart';

import '../test/food_location_test.dart' show NativeFixture, WorkApi;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('cancelled synthetic pickup proof keeps custody actionable without submit', (
    tester,
  ) async {
    final previous = GeolocatorPlatform.instance;
    final native = NativeFixture();
    final api = WorkApi();
    GeolocatorPlatform.instance = native;
    addTearDown(() {
      api.close();
      GeolocatorPlatform.instance = previous;
    });

    await tester.pumpWidget(
      MaterialApp(home: FoodWorkPage(api: api, thai: false)),
    );
    await tester.pumpAndSettle();

    final custody = find.byKey(const ValueKey('food-custody-PICKUP'));
    await tester.scrollUntilVisible(custody, 300);
    await tester.ensureVisible(custody);
    await tester.tap(custody);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(AlertDialog), findsOneWidget);

    await tester.enterText(
      find.descendant(of: find.byType(AlertDialog), matching: find.byType(TextField)),
      'synthetic-unsubmitted-secret',
    );
    final cancel = find.widgetWithText(TextButton, 'Cancel');
    await tester.ensureVisible(cancel);
    await tester.tap(cancel);
    await tester.pumpAndSettle();

    expect(find.byType(AlertDialog), findsNothing);
    await tester.scrollUntilVisible(custody, 250);
    await tester.ensureVisible(custody);
    expect(tester.widget<FilledButton>(custody).onPressed, isNotNull);
    expect(api.submitted, isEmpty);
    expect(tester.takeException(), isNull);
    binding.reportData = {
      'status': 'PASS',
      'scenario': 'synthetic_cancel_keeps_pickup_actionable',
      'submission': 'none',
      'physicalTesting': 'deferred_by_user_2026-10-16',
    };
  });
}
