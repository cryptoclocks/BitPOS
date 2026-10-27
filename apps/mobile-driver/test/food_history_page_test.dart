import 'package:bitpos_driver/presentation/driver_history_card.dart';

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/food_history_page.dart';

import 'driver_earnings_surface_test.dart' show EarningsApi, first, second;

FoodDriverHistory history({
  String id = first,
  String state = 'DELIVERED',
  String? next = second,
}) => FoodDriverHistory(
  items: [
    FoodDriverHistoryItem(
      id: id,
      shipmentId: id,
      state: state,
      acceptedAt: '2026-10-19T00:00:00Z',
      closedAt: '2026-10-19T00:10:00Z',
      quotedDriverFee: MobileMoney(
        currency: 'USD',
        decimals: 2,
        amountMinor: '270',
      ),
    ),
  ],
  nextCursor: next,
);

FoodDriverHistory emptyHistory({String? next}) =>
    FoodDriverHistory(items: const [], nextCursor: next);

class HistoryApi extends EarningsApi {
  bool fail = false, deny = false, empty = false;
  String newestState = 'DELIVERED';
  Completer<FoodDriverHistory>? held;
  final cursors = <String?>[];
  final compensationAssignments = <String>[];
  @override
  Future<FoodDriverCompensation> foodDriverCompensation(
    String assignmentId,
  ) async {
    compensationAssignments.add(assignmentId);
    return FoodDriverCompensation.fromJson({
      'assignmentId': assignmentId,
      'execution': null,
    });
  }

  @override
  Future<FoodDriverHistory> driverFoodHistory({String? cursor}) async {
    cursors.add(cursor);
    if (held != null) return held!.future;
    if (deny) throw const MobileApiException('ROLE_REQUIRED', 403);
    if (fail) {
      fail = false;
      throw const MobileApiException('RESPONSE_UNAVAILABLE', 503);
    }
    if (empty) return emptyHistory(next: cursor == null ? second : null);
    return cursor == null
        ? history(state: newestState)
        : history(id: second, state: 'RELEASED', next: null);
  }
}

Future<void> mountHistory(WidgetTester tester, HistoryApi api) async {
  addTearDown(api.close);
  await tester.pumpWidget(
    MaterialApp(home: DriverFoodHistoryPage(api: api, thai: false)),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'returned history opens exact assignment and Back preserves history',
    (tester) async {
      final api = HistoryApi()..newestState = 'RETURNED';
      await mountHistory(tester, api);
      final entry = find.text('Check compensation for this assignment');
      await tester.ensureVisible(entry);
      await tester.tap(entry);
      await tester.pumpAndSettle();
      expect(find.text('Returned food compensation'), findsOneWidget);
      expect(api.compensationAssignments, isEmpty);
      await tester.tap(find.text('Check compensation'));
      await tester.pumpAndSettle();
      expect(api.compensationAssignments, [first]);
      expect(find.text('No compensation case recorded'), findsOneWidget);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Delivery history'), findsOneWidget);
      expect(find.textContaining('Returned to merchant ·'), findsOneWidget);
    },
  );
  testWidgets('delivered history has no returned compensation entry', (
    tester,
  ) async {
    await mountHistory(tester, HistoryApi());
    expect(find.text('Check compensation for this assignment'), findsNothing);
  });
  testWidgets(
    'returned job history names the return and retains quoted fee without earning claim',
    (tester) async {
      final api = HistoryApi()..newestState = 'RETURNED';
      await mountHistory(tester, api);
      expect(find.textContaining('Returned to merchant ·'), findsOneWidget);
      expect(find.textContaining('Quoted delivery fee'), findsOneWidget);
      expect(find.textContaining('Delivered ·'), findsNothing);
      expect(find.textContaining('Assignment released ·'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Thai narrow history preserves quoted amount without transfer claim',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
            child: Scaffold(
              body: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: DriverHistoryCard(
                    item: history().items.first,
                    thai: true,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      expect(find.text('ค่าจัดส่งตามราคาเดิม'), findsOneWidget);
      expect(find.text('2.70 USD'), findsOneWidget);
      expect(find.textContaining('โอนแล้ว'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'older page retries retained cursor after failure without claiming paid earnings',
    (tester) async {
      final api = HistoryApi();
      await mountHistory(tester, api);
      expect(find.textContaining('Quoted delivery fee'), findsOneWidget);
      api.fail = true;
      await tester.tap(find.text('Older deliveries'));
      await tester.pumpAndSettle();
      expect(find.textContaining('History unavailable.'), findsOneWidget);
      await tester.tap(find.text('Older deliveries'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Assignment released ·'), findsOneWidget);
      expect(find.textContaining('Delivered ·'), findsNothing);
      expect(api.cursors, [null, second, second]);
    },
  );
  testWidgets('replacement owner cannot receive delayed history', (
    tester,
  ) async {
    final api = HistoryApi();
    await mountHistory(tester, api);
    final held = Completer<FoodDriverHistory>();
    api.held = held;
    await tester.tap(find.text('Newest'));
    await tester.pump();
    api.change((accountId: first, sessionId: second));
    await tester.pump();
    held.complete(history());
    await tester.pumpAndSettle();
    expect(find.text('Sign in again'), findsOneWidget);
    expect(find.textContaining('Delivered ·'), findsNothing);
  });
  testWidgets('background clears private history and resume reloads', (
    tester,
  ) async {
    final api = HistoryApi();
    await mountHistory(tester, api);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(find.textContaining('Delivered ·'), findsNothing);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.textContaining('Delivered ·'), findsOneWidget);
    expect(api.cursors.length, 2);
  });
  testWidgets(
    'server role refusal clears previous page even if local session exists',
    (tester) async {
      final api = HistoryApi();
      await mountHistory(tester, api);
      api.deny = true;
      await tester.tap(find.text('Older deliveries'));
      await tester.pumpAndSettle();
      expect(find.text('Sign in again'), findsOneWidget);
      expect(find.textContaining('Delivered ·'), findsNothing);
    },
  );
  testWidgets('empty and unavailable history keep truthful recovery controls', (
    tester,
  ) async {
    final api = HistoryApi()..empty = true;
    await mountHistory(tester, api);
    expect(find.text('No closed deliveries yet.'), findsOneWidget);
    expect(find.text('Older deliveries'), findsOneWidget);
    api.empty = false;
    await tester.tap(find.text('Older deliveries'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Assignment released ·'), findsOneWidget);

    api.fail = true;
    await tester.tap(find.text('Newest'));
    await tester.pumpAndSettle();
    expect(find.textContaining('History unavailable.'), findsOneWidget);
    await tester.tap(find.text('Newest'));
    await tester.pumpAndSettle();
    expect(find.textContaining('Quoted delivery fee'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
