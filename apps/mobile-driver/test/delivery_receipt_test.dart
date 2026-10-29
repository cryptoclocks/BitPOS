import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/food_work_page.dart';
import 'package:bitpos_driver/earnings_page.dart';
import 'driver_earnings_surface_test.dart' as earnings;
import 'food_realtime_lifecycle_test.dart' show ActiveNative;
import 'food_location_test.dart' as jobs;

class ReceiptApi extends earnings.EarningsApi {
  ReceiptApi(this.accrual);
  final bool accrual;
  Completer<void>? consumeGate;
  FoodDriverWork duty = FoodDriverWork(offers: [], assignment: FoodDriverAssignment.fromJson({...jobs.job(jobs.first).toJson(), 'state': 'AT_DROPOFF', 'proofs': [{'id': jobs.second, 'kind': 'DELIVERY', 'expiresAt': DateTime.now().add(const Duration(minutes: 5)).toUtc().toIso8601String(), 'attemptsRemaining': 10}]}));
  @override
  Stream<FoodRealtimeState<FoodDriverRealtimeSnapshot>> watchFoodWork() => const Stream.empty();
  @override
  Future<FoodDispatchMutation?> pendingFoodDispatch() async => null;
  @override
  Future<FoodDriverWork> foodDriverWork() async => duty;
  @override
  Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
    final consume = command as FoodConsumeMutation;
    duty = FoodDriverWork(offers: [], assignment: null);
    await consumeGate?.future;
    return FoodProofAccepted(FoodProofConfirmed(accepted: true, assignmentId: jobs.first, proofId: consume.command.proofId, kind: 'DELIVERY', consumedAt: '2026-10-23T01:02:00Z', accrualId: accrual ? jobs.second : null));
  }
}

void useMobileViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}
Future<void> openProofDialog(WidgetTester tester, Finder proof) async {
  await tester.scrollUntilVisible(proof, 250);
  await tester.ensureVisible(proof);
  for (var attempt = 0; attempt < 30; attempt++) {
    if (tester.widget<FilledButton>(proof).onPressed != null) break;
    await tester.pump(const Duration(milliseconds: 100));
  }
  expect(tester.widget<FilledButton>(proof).onPressed, isNotNull);
  await tester.tap(proof);
  await tester.pumpAndSettle();
  expect(find.byType(TextField), findsOneWidget);
}


void main({Future<void> Function(WidgetTester, bool)? capture}) {
  for (final replacement in <({String accountId, String sessionId})?>[
    null,
    (accountId: earnings.second, sessionId: earnings.second),
    (accountId: earnings.first, sessionId: earnings.second),
  ]) {
  for (final accrued in [false, true]) {
    testWidgets('confirmed delivery distinguishes obligation and safely opens earnings; accrued=$accrued owner=$replacement', (tester) async {
      useMobileViewport(tester);
      final previous = GeolocatorPlatform.instance;
      final native = ActiveNative();
      GeolocatorPlatform.instance = native;
      final api = ReceiptApi(accrued);
      addTearDown(() {api.close();native.close();GeolocatorPlatform.instance = previous;});
      await tester.pumpWidget(MaterialApp(
        theme: BitPosTheme.light(),
        home: Builder(builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(
              builder: (_) => FoodWorkPage(api: api, thai: false),
            )),
            child: const Text('Open work'),
          ),
        )),
      ));
      await tester.tap(find.text('Open work'));
      await tester.pumpAndSettle();
      final proof = find.byKey(const ValueKey('food-custody-DELIVERY'));
      await openProofDialog(tester, proof);
      await tester.enterText(find.byType(TextField), 'a' * 43);
      await tester.tap(find.widgetWithText(FilledButton, 'Confirm'));
      await tester.pumpAndSettle();
      final receipt = find.byKey(const ValueKey('food-delivery-confirmed'));
      await tester.scrollUntilVisible(receipt, -250);
      expect(find.text('Delivery confirmed'), findsOneWidget);
      expect(find.text('Private location for food matching'), findsNothing);
      expect(find.text('Offers near you'), findsNothing);
      final status = find.byKey(const ValueKey('food-delivery-obligation-status'));
      await tester.ensureVisible(status);
      await tester.pumpAndSettle();
      expect(find.text(accrued ? 'Earning obligation recorded' : 'Delivery proof confirmed'), findsOneWidget);
      if (capture != null && replacement == null) await capture(tester, accrued);
      final cta = find.byKey(const ValueKey('food-delivery-view-earnings'));
      await tester.ensureVisible(cta);
      await tester.pumpAndSettle();
      await tester.tap(cta);
      await tester.tap(cta, warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(find.byType(DriverEarningsPage), findsOneWidget);
      if (accrued) {
        final context = tester.element(find.byType(DriverEarningsPage));
        unawaited(Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const Scaffold(body: Text('Unrelated route')))));
        await tester.pumpAndSettle();
      }
      api.change(replacement);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('food-delivery-confirmed'), skipOffstage: false), findsNothing);
      expect(find.byType(DriverEarningsPage), findsNothing);
      if (accrued) {
        expect(find.text('Unrelated route'), findsOneWidget);
        Navigator.of(tester.element(find.text('Unrelated route'))).pop();
        await tester.pumpAndSettle();
        expect(find.byKey(const ValueKey('food-delivery-confirmed')), findsNothing);
      }
      expect(tester.takeException(), isNull);
    });
  }
  }
  for (final restoreOriginal in [false, true]) {
    testWidgets('late proof response cannot revive retired receipt; restore=$restoreOriginal', (tester) async {
      useMobileViewport(tester);
      final previous = GeolocatorPlatform.instance;
      final native = ActiveNative();
      GeolocatorPlatform.instance = native;
      final api = ReceiptApi(true)..consumeGate = Completer<void>();
      final original = api.sessionScope;
      addTearDown(() {api.close();native.close();GeolocatorPlatform.instance = previous;});
      await tester.pumpWidget(MaterialApp(home: FoodWorkPage(api: api, thai: false)));
      await tester.pumpAndSettle();
      final proof = find.byKey(const ValueKey('food-custody-DELIVERY'));
      await openProofDialog(tester, proof);
      await tester.enterText(find.byType(TextField), 'a' * 43);
      await tester.tap(find.widgetWithText(FilledButton, 'Confirm'));
      await tester.pump(const Duration(milliseconds: 350));
      api.change(null);
      if (restoreOriginal) api.change(original);
      api.consumeGate!.complete();
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('food-delivery-confirmed')), findsNothing);
      expect(find.text('Earning obligation recorded'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
  for (final thai in [false, true]) {
    testWidgets('next job leaves completed receipt and reloads actual Work; thai=$thai', (tester) async {
      useMobileViewport(tester);
      final previous = GeolocatorPlatform.instance;
      final native = ActiveNative();
      GeolocatorPlatform.instance = native;
      final api = ReceiptApi(true);
      addTearDown(() {api.close();native.close();GeolocatorPlatform.instance = previous;});
      await tester.pumpWidget(MaterialApp(theme: BitPosTheme.light(), home: FoodWorkPage(api: api, thai: thai)));
      await tester.pumpAndSettle();
      final proof = find.byKey(const ValueKey('food-custody-DELIVERY'));
      await openProofDialog(tester, proof);
      await tester.enterText(find.byType(TextField), 'a' * 43);
      await tester.tap(find.widgetWithText(FilledButton, thai ? 'ยืนยัน' : 'Confirm'));
      await tester.pumpAndSettle();
      expect(find.text(thai ? 'งานนี้ส่งสำเร็จแล้ว' : 'Delivery confirmed'), findsOneWidget);
      final next = find.byKey(const ValueKey('food-delivery-next-job'));
      await tester.ensureVisible(next);
      await tester.pumpAndSettle();
      await tester.tap(next);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('food-delivery-completion-page')), findsNothing);
      expect(find.byKey(const ValueKey('food-delivery-confirmed')), findsNothing);
      expect(find.text(thai ? 'พร้อมรับงานวันนี้' : 'Ready for work today'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
