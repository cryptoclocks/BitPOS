import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/order_refunds_sheet.dart';
import 'package:bitpos_customer/food_page.dart';

import 'food_history_test.dart' as fixture;

MobileRefund refund(int n) => MobileRefund(
  id: '${n.toString().padLeft(8, '0')}-0000-4000-8000-000000000001',
  version: '1',
  money: MobileMoney(currency: 'USDG', decimals: 6, amountMinor: '2700000'),
  status: 'REQUESTED',
  cause: 'ONLINE_ACCEPTANCE_REJECTED',
);

class RefundApi extends MobileApi {
  RefundApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  String executionState = 'FINALIZED';
  bool executionDenied = false;
  @override
  Future<FoodCustomerRefundExecution> foodRefundExecution(
    String orderId,
  ) async {
    if (executionDenied) throw const MobileApiException('AUTH_REQUIRED', 401);
    return FoodCustomerRefundExecution(
      orderId: orderId,
      execution: FoodReturnExecution(
        caseId: fixture.id(9),
        state: executionState,
        paymentCount: 1,
        allocationCount: 1,
        finalizedCount: 1,
        failedCount: executionState == 'RECONCILIATION_REQUIRED' ? 1 : 0,
        disputed: executionState == 'RECONCILIATION_REQUIRED',
        unallocatedPaymentCount: 0,
        allPaymentsRefunded: executionState == 'FINALIZED',
        selectedRefund: executionState == 'SELECTED_FINALIZED'
            ? FoodSelectedRefund(
                lineId: fixture.id(11),
                name: 'อาหาร',
                nameEn: 'Food',
                qty: 1,
                selections: [],
                catalogAmount: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270'),
                paymentId: fixture.id(12),
                refundAmount: MobileMoney(currency: 'USDG', decimals: 6, amountMinor: '2700000'),
              )
            : null,
      ),
    );
  }

  var failed = false;
  final held = Completer<MobileFoodRefunds>();
  bool delayed = false, changed = false;
  bool tall = false;
  @override
  Future<MobileFoodRefunds> foodRefunds(
    String id, {
    ({String cursor, String generation})? after,
  }) async {
    if (delayed) return held.future;
    if (after != null && changed) {
      throw const MobileApiException('REFUND_PAGE_CHANGED', 409);
    }
    if (after != null && !failed) {
      failed = true;
      throw TimeoutException('Fixture disconnected');
    }
    return MobileFoodRefunds(
      refunds: [refund(after == null ? 1 : 31)],
      nextCursor: after == null ? fixture.id(30) : null,
      generation: '1',
    );
  }

  @override
  Future<MobileBranches> branches({
    String? cursor,
    String search = '',
    String serving = 'all',
  }) async => MobileBranches(branches: [], nextCursor: null);
  @override
  Future<MobileFoodOrderRequest?> pendingFoodOrder() async => null;
  @override
  Future<String?> activeFoodOrderId() async => fixture.id(100);
  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async =>
      MobileFoodEvents(
        order: MobileFoodOrder.fromJson({
          ...fixture.order(100, nextRefundCursor: fixture.id(30)).toJson(),
          if (tall)
            'refunds': [for (var i = 1; i <= 30; i++) refund(i).toJson()],
        }),
        events: [],
        nextCursor: null,
      );
}

void main() {
  testWidgets('selected-line finality displays only its original-asset amount, never whole-payment completion', (tester) async {
    final api = RefundApi()..executionState = 'SELECTED_FINALIZED';
    addTearDown(api.close);
    await tester.pumpWidget(MaterialApp(home: OrderRefundsSheet(
      api: api,
      orderId: fixture.id(100),
      firstPage: MobileFoodRefunds(refunds: [], nextCursor: null, generation: '1'),
      thai: false,
      onAuthenticationRequired: () {},
    )));
    await tester.ensureVisible(find.text('Check refund execution'));
    await tester.tap(find.text('Check refund execution'));
    await tester.pumpAndSettle();
    expect(find.text('Selected line refunded; not all original payments'), findsOneWidget);
    final selectedAmount = find.byWidgetPredicate((w) => w is Text && (w.data?.contains('2.700000') ?? false) && (w.data?.contains('USDG') ?? false));
    expect(selectedAmount, findsOneWidget);
    expect(find.text('All payments refunded with finalized evidence'), findsNothing);
    api.executionDenied = true;
    await tester.tap(find.text('Check refund execution'));
    await tester.pumpAndSettle();
    expect(selectedAmount, findsNothing);
    expect(find.text('Selected line refunded; not all original payments'), findsNothing);
  });
  testWidgets(
    'customer execution reads finalized evidence then clears completion on dispute and auth refusal',
    (tester) async {
      final api = RefundApi();
      addTearDown(api.close);
      var auth = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: OrderRefundsSheet(
            api: api,
            orderId: fixture.id(100),
            firstPage: MobileFoodRefunds(
              refunds: [],
              nextCursor: null,
              generation: '1',
            ),
            thai: false,
            onAuthenticationRequired: () => auth++,
          ),
        ),
      );
      await tester.ensureVisible(find.text('Check refund execution'));
      await tester.tap(find.text('Check refund execution'));
      await tester.pumpAndSettle();
      expect(
        find.text('All payments refunded with finalized evidence'),
        findsOneWidget,
      );
      expect(
        find.text(
          'A refund obligation is recorded. No verified return-transfer receipt is available yet.',
        ),
        findsNothing,
      );
      api.executionState = 'RECONCILIATION_REQUIRED';
      await tester.tap(find.text('Check refund execution'));
      await tester.pumpAndSettle();
      expect(
        find.text('All payments refunded with finalized evidence'),
        findsNothing,
      );
      expect(
        find.text('Reconciliation required; refund completion unconfirmed'),
        findsOneWidget,
      );
      api.executionDenied = true;
      await tester.tap(find.text('Check refund execution'));
      await tester.pumpAndSettle();
      expect(
        find.text('Reconciliation required; refund completion unconfirmed'),
        findsNothing,
      );
      expect(auth, 1);
      expect(tester.takeException(), isNull);
    },
  );
  Future<void> reveal(WidgetTester tester, String text) async {
    final target = find.text(text);
    if (target.evaluate().isEmpty) {
      await tester.scrollUntilVisible(
        target,
        220,
        scrollable: find.byType(Scrollable).last,
      );
    }
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
  }

  testWidgets(
    'U25 presents truthful refund status, order context, and both actions',
    (tester) async {
      tester.view.physicalSize = Size(
        390 * tester.view.devicePixelRatio,
        1200 * tester.view.devicePixelRatio,
      );
      addTearDown(tester.view.resetPhysicalSize);
      final api = RefundApi();
      addTearDown(api.close);
      var orderOpened = false;
      var supportOpened = false;
      int? selectedDestination;
      await tester.pumpWidget(
        MaterialApp(
          home: OrderRefundsSheet(
            api: api,
            orderId: fixture.id(100),
            order: fixture.order(100),
            firstPage: MobileFoodRefunds(
              refunds: [refund(1)],
              nextCursor: null,
              generation: '1',
            ),
            thai: false,
            onAuthenticationRequired: () {},
            onViewOrder: () => orderOpened = true,
            onContactSupport: () => supportOpened = true,
            onNavigation: (index) => selectedDestination = index,
          ),
        ),
      );
      expect(
        find.text(
          'A refund obligation is recorded. No verified return-transfer receipt is available yet.',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('Order #00000000'), findsOneWidget);
      expect(find.text('View order status'), findsOneWidget);
      expect(find.text('Contact support'), findsOneWidget);
      expect(find.text('Orders'), findsOneWidget);
      expect(find.text('Favourites'), findsOneWidget);
      expect(find.text('Account'), findsOneWidget);
      await tester.tap(find.text('View order status'));
      await tester.tap(find.text('Contact support'));
      await tester.tap(find.text('Orders'));
      expect(orderOpened, isTrue);
      expect(supportOpened, isTrue);
      expect(selectedDestination, 1);
      expect(
        find.text('This record contains no verified return-transfer receipt.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'tall owned refund page keeps its header below the status inset and paging reachable',
    (tester) async {
      tester.view.padding = FakeViewPadding(
        top: 80 * tester.view.devicePixelRatio,
      );
      addTearDown(tester.view.resetPadding);
      final api = RefundApi()..tall = true;
      addTearDown(api.close);
      final owner = ValueNotifier(true);
      addTearDown(owner.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                owner: owner,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('All refund pages / refresh'));
      await tester.tap(find.text('All refund pages / refresh'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await reveal(tester, 'Other refund requests');
      await reveal(tester, 'First page / refresh');
      await reveal(tester, 'Next refund obligations');
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Next refund obligations'),
            )
            .onPressed,
        isNotNull,
      );
      await tester.pumpWidget(const MaterialApp());
      await tester.pumpAndSettle();
    },
  );
  testWidgets(
    'failed refund continuation retains page and retries same cursor then refreshes',
    (tester) async {
      final api = RefundApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: OrderRefundsSheet(
              api: api,
              orderId: fixture.id(100),
              firstPage: MobileFoodRefunds(
                refunds: [refund(1)],
                nextCursor: fixture.id(30),
                generation: '1',
              ),
              thai: false,
              onAuthenticationRequired: () {},
            ),
          ),
        ),
      );
      await reveal(tester, 'Next refund obligations');
      await tester.tap(find.text('Next refund obligations'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Could not load refunds'), findsOneWidget);
      expect(find.textContaining('#00000001'), findsOneWidget);
      expect(find.textContaining('#00000031'), findsNothing);
      await tester.tap(find.text('Next refund obligations'));
      await tester.pumpAndSettle();
      expect(find.text('Next refund obligations'), findsNothing);
      expect(find.textContaining('Could not load refunds'), findsNothing);
      expect(find.textContaining('#00000031'), findsOneWidget);
      expect(find.textContaining('#00000001'), findsNothing);
      await reveal(tester, 'First page / refresh');
      await tester.tap(find.text('First page / refresh'));
      await tester.pumpAndSettle();
      expect(find.text('Next refund obligations'), findsOneWidget);
      expect(find.textContaining('#00000001'), findsOneWidget);
      expect(find.textContaining('#00000031'), findsNothing);
    },
  );
  testWidgets(
    'changed refund generation requires first-page refresh before continuation',
    (tester) async {
      final api = RefundApi()..changed = true;
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: OrderRefundsSheet(
              api: api,
              orderId: fixture.id(100),
              firstPage: MobileFoodRefunds(
                refunds: [refund(1)],
                nextCursor: fixture.id(30),
                generation: '0',
              ),
              thai: false,
              onAuthenticationRequired: () {},
            ),
          ),
        ),
      );
      await reveal(tester, 'Next refund obligations');
      await tester.tap(find.text('Next refund obligations'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Refund history changed. Refresh the first page to continue.',
        ),
        findsOneWidget,
      );
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Next refund obligations'),
            )
            .onPressed,
        isNull,
      );
      await reveal(tester, 'First page / refresh');
      await tester.tap(find.text('First page / refresh'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Refund history changed. Refresh the first page to continue.',
        ),
        findsNothing,
      );
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Next refund obligations'),
            )
            .onPressed,
        isNotNull,
      );
    },
  );
  testWidgets(
    'owned refund page and late page disappear when account is replaced',
    (tester) async {
      final api = RefundApi()..delayed = true;
      addTearDown(api.close);
      final owner = ValueNotifier(true);
      addTearDown(owner.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                owner: owner,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('All refund pages / refresh'));
      await tester.tap(find.text('All refund pages / refresh'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await reveal(tester, 'Next refund obligations');
      await tester.tap(find.text('Next refund obligations'));
      await tester.pump();
      owner.value = false;
      await tester.pumpWidget(
        const MaterialApp(home: Text('Replacement account')),
      );
      api.held.complete(
        MobileFoodRefunds(
          refunds: [refund(31)],
          nextCursor: null,
          generation: '1',
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Other refund requests'), findsNothing);
      expect(find.text('Replacement account'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
