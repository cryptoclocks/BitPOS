import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/food_compensation_page.dart';

import 'driver_earnings_surface_test.dart' show EarningsApi, first, second;

FoodDriverCompensation value(String state) => FoodDriverCompensation.fromJson({
  'assignmentId': first,
  'execution': {
    'caseId': first,
    'state': state,
    'fundsTransferred': state == 'FINALIZED',
    'approvedAmount': {
      'currency': 'USDG',
      'decimals': 6,
      'amountMinor': '1000000',
    },
  },
});

class Api extends EarningsApi {
  String state = 'FINALIZED';
  bool fail = false;
  Completer<FoodDriverCompensation>? held;
  @override
  Future<FoodDriverCompensation> foodDriverCompensation(String id) async {
    if (held != null) return held!.future;
    if (fail) throw const MobileApiException('RESPONSE_UNAVAILABLE', 503);
    return value(state);
  }
}

Future<void> mount(WidgetTester tester, Api api) async {
  addTearDown(api.close);
  await tester.pumpWidget(
    MaterialApp(
      home: DriverFoodCompensationPage(
        api: api,
        assignmentId: first,
        thai: false,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> check(WidgetTester tester) async {
  await tester.tap(find.text('Check compensation'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'refresh replaces finalized with disputed and clears old facts on outage',
    (tester) async {
      final api = Api();
      await mount(tester, api);
      await check(tester);
      expect(
        find.byKey(const ValueKey('compensation-FINALIZED')),
        findsOneWidget,
      );
      api.state = 'RECONCILIATION_REQUIRED';
      await check(tester);
      expect(
        find.byKey(const ValueKey('compensation-FINALIZED')),
        findsNothing,
      );
      expect(
        find.byKey(const ValueKey('compensation-RECONCILIATION_REQUIRED')),
        findsOneWidget,
      );
      api.fail = true;
      await check(tester);
      expect(find.textContaining('Approved amount:'), findsNothing);
      expect(
        find.byKey(const ValueKey('compensation-RECONCILIATION_REQUIRED')),
        findsNothing,
      );
    },
  );
  testWidgets('owner change fences delayed financial response', (tester) async {
    final api = Api();
    await mount(tester, api);
    final held = Completer<FoodDriverCompensation>();
    api.held = held;
    await tester.tap(find.text('Check compensation'));
    await tester.pump();
    api.change((accountId: second, sessionId: second));
    await tester.pump();
    held.complete(value('FINALIZED'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in again'), findsOneWidget);
    expect(find.byKey(const ValueKey('compensation-FINALIZED')), findsNothing);
  });
  testWidgets('background clears result and discards delayed response', (
    tester,
  ) async {
    final api = Api();
    await mount(tester, api);
    await check(tester);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.byKey(const ValueKey('compensation-FINALIZED')), findsNothing);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('compensation-FINALIZED')), findsNothing);
  });
}
