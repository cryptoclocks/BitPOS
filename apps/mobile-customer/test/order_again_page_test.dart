import 'dart:async';

import 'package:bitpos_customer/order_again_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_history_test.dart' as history;

class _Api extends MobileApi {
  _Api()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  ({String accountId, String sessionId})? scope = (
    accountId: history.id(200),
    sessionId: history.id(201),
  );
  final changes =
      StreamController<({String accountId, String sessionId})?>.broadcast();
  @override
  ({String accountId, String sessionId})? get sessionScope => scope;
  @override
  Stream<({String accountId, String sessionId})?> get sessionScopes =>
      changes.stream;
  List<MobileFoodOrderSummary> summaries = [history.summary(1)];
  final requested = <String>[];
  final details = <String, MobileFoodOrder>{};
  Object? failure;
  Completer<MobileFoodOrder>? delayed;
  @override
  Future<MobileFoodOrders> foodOrders({String? cursor}) async {
    expect(cursor, isNull);
    if (failure != null) throw failure!;
    return MobileFoodOrders(orders: summaries, nextCursor: history.id(99));
  }

  @override
  Future<MobileFoodOrder> foodOrder(String id) async {
    requested.add(id);
    return delayed?.future ??
        details[id] ??
        history.order(int.parse(id.split('-').last));
  }

  void switchSession() {
    scope = (accountId: history.id(300), sessionId: history.id(301));
    changes.add(scope);
  }
}

Widget app(
  _Api api,
  ValueNotifier<bool> owner, {
  bool thai = false,
  VoidCallback? onAuth,
}) => MaterialApp(
  home: OrderAgainPage(
    api: api,
    owner: owner,
    thai: thai,
    onAuthenticationRequired: onAuth ?? () {},
  ),
);
void main() {
  late _Api api;
  late ValueNotifier<bool> owner;
  setUp(() {
    api = _Api();
    owner = ValueNotifier(true);
  });
  tearDown(() async {
    api.close();
    await api.changes.close();
    owner.dispose();
  });
  testWidgets('only own paid accepted history, no price or ordering action', (
    tester,
  ) async {
    api.summaries = [
      history.summary(1),
      history.summary(2, status: 'AWAITING_PAYMENT'),
      history.summary(3, acceptanceStatus: 'REJECTED'),
      history.summary(4),
    ];
    api.details[history.id(4)] = MobileFoodOrder.fromJson({
      ...history.order(4).toJson(),
      'status': 'RECOVERY',
    });
    await tester.pumpWidget(app(api, owner));
    await tester.pumpAndSettle();
    expect(api.requested, [history.id(1), history.id(4)]);
    expect(find.text('1 × Fixture food'), findsOneWidget);
    expect(
      find.textContaining('Read-only suggestions from your latest 30'),
      findsOneWidget,
    );
    expect(
      find.textContaining('This page creates no order or payment'),
      findsOneWidget,
    );
    expect(find.textContaining('2.70'), findsNothing);
    expect(find.byType(FilledButton), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('bounds detail reads to ten and filters refund records', (
    tester,
  ) async {
    api.summaries = List.generate(30, (i) => history.summary(i + 1));
    api.details[history.id(1)] = history.order(
      1,
      nextRefundCursor: history.id(500),
    );
    await tester.pumpWidget(app(api, owner));
    await tester.pumpAndSettle();
    expect(api.requested.length, 10);
    expect(find.byKey(ValueKey('order-again.${history.id(1)}')), findsNothing);
    expect(
      find.byKey(ValueKey('order-again.${history.id(2)}')),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('session switch discards in-flight detail and clears old data', (
    tester,
  ) async {
    api.delayed = Completer<MobileFoodOrder>();
    await tester.pumpWidget(app(api, owner));
    await tester.pump();
    api.switchSession();
    await tester.pump();
    api.delayed!.complete(history.order(1));
    await tester.pumpAndSettle();
    expect(find.text('1 × Fixture food'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('empty Thai state, failure retry and authentication handling', (
    tester,
  ) async {
    api.summaries = [];
    await tester.pumpWidget(app(api, owner, thai: true));
    await tester.pumpAndSettle();
    expect(find.text('ยังไม่มีรายการที่แนะนำจากประวัติของคุณ'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    api.failure = Exception('offline');
    var auth = 0;
    await tester.pumpWidget(app(api, owner, onAuth: () => auth++));
    await tester.pumpAndSettle();
    expect(find.text('Could not load suggestions. Try again.'), findsOneWidget);
    api.failure = const MobileApiException('AUTH_REQUIRED', 401);
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(auth, 1);
    expect(find.text('1 × Fixture food'), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('owner revocation clears already rendered history', (
    tester,
  ) async {
    await tester.pumpWidget(app(api, owner));
    await tester.pumpAndSettle();
    expect(find.text('1 × Fixture food'), findsOneWidget);
    owner.value = false;
    await tester.pumpAndSettle();
    expect(find.text('1 × Fixture food'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
