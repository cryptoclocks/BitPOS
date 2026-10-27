import 'package:bitpos_customer/presentation/customer_order_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/order_history_sheet.dart';

String id(int n) => '00000000-0000-4000-8000-${n.toString().padLeft(12, '0')}';
MobileFoodOrder order(int n, {String? nextRefundCursor}) {
  final money = MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270');
  return MobileFoodOrder(
    preparation: null,
    id: id(n),
    merchantId: id(100),
    branchId: id(101),
    status: 'PAID',
    version: 2,
    acceptanceStatus: 'ACCEPTED',
    acceptanceVersion: 1,
    acceptanceDeadline: '2026-10-16T00:01:00Z',
    acceptanceReason: null,
    eventSequence: '6',
    refunds: [],
    nextRefundCursor: nextRefundCursor,
    fulfillmentStatus: 'COLLECTED',
    fulfillmentVersion: 3,
    createdAt: '2026-10-16T00:00:00Z',
    quoteExpiresAt: '2026-10-16T00:01:00Z',
    total: money,
    settlement: MobileSettlement(
      money: MobileMoney(currency: 'USDG', decimals: 6, amountMinor: '2700000'),
      recipient: 'fixture',
      network: 'solana:devnet',
      genesisHash: 'fixture',
      mint: 'fixture',
      tokenProgram: 'fixture',
      testToken: true,
    ),
    lines: [
      MobileFoodLine(
        productId: id(102),
        name: 'อาหารทดสอบ',
        nameEn: 'Fixture food',
        qty: 1,
        unitPrice: money,
        basePrice: money,
      ),
    ],
    paymentUrl: 'https://pay.bitpos.invalid/pay/fixture',
    configured: null,
    delivery: null,
  );
}

MobileFoodOrderSummary summary(
  int n, {
  String? createdAt,
  String status = 'PAID',
  String acceptanceStatus = 'ACCEPTED',
  String fulfillmentStatus = 'COLLECTED',
}) {
  final o = order(n);
  return MobileFoodOrderSummary(
    id: o.id,
    merchantId: o.merchantId,
    branchId: o.branchId,
    merchantName: 'BitPOS Coffee House',
    createdAt: createdAt ?? o.createdAt,
    status: status,
    acceptanceStatus: acceptanceStatus,
    fulfillmentStatus: fulfillmentStatus,
    total: o.total,
  );
}

class HistoryApi extends MobileApi {
  HistoryApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  bool failOlder = true;
  @override
  Future<MobileFoodOrders> foodOrders({String? cursor}) async {
    if (cursor == id(30)) {
      if (failOlder) {
        failOlder = false;
        throw Exception('offline fixture');
      }
      return MobileFoodOrders(orders: [summary(31)], nextCursor: null);
    }
    return firstPage();
  }

  MobileFoodOrders firstPage() => MobileFoodOrders(
    orders: List.generate(30, (i) => summary(i + 1)),
    nextCursor: id(30),
  );
}

void main() {
  testWidgets(
    'U23 activity status stays truthful and fits beside date and total',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final now = tester.binding.clock.now();
      final item = summary(
        91,
        createdAt: now.toUtc().toIso8601String(),
        status: 'AWAITING_WALLET',
        acceptanceStatus: 'PENDING',
        fulfillmentStatus: 'RECEIVED',
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: CustomerOrderCard(
                order: item,
                thai: false,
                clock: () => now,
              ),
            ),
          ),
        ),
      );
      final subtitle = find.byWidgetPredicate(
        (widget) =>
            widget is Text && widget.data?.startsWith('Payment due ·') == true,
      );
      expect(subtitle, findsOneWidget);
      expect(
        tester.renderObject<RenderParagraph>(subtitle).didExceedMaxLines,
        isFalse,
      );
    },
  );

  testWidgets('U23 merchant row matches the 390px FigCraft card geometry', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final api = HistoryApi();
    addTearDown(api.close);
    final now = tester.binding.clock.now();
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(
            padding: EdgeInsets.only(top: 44),
            viewPadding: EdgeInsets.only(top: 44),
          ),
          child: OrderHistorySheet(
            api: api,
            clock: () => now,
            firstPage: MobileFoodOrders(
              orders: [
                summary(1, createdAt: now.toUtc().toIso8601String()),
                summary(
                  2,
                  createdAt: now
                      .subtract(const Duration(days: 1))
                      .toUtc()
                      .toIso8601String(),
                ),
                summary(
                  3,
                  createdAt: now
                      .subtract(const Duration(days: 9))
                      .toUtc()
                      .toIso8601String(),
                ),
              ],
              nextCursor: null,
            ),
            thai: false,
            onAuthenticationRequired: () {},
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final card = tester.getRect(find.byType(CustomerOrderCard).first);
    expect(card.left, 24);
    expect(card.top, 222);
    expect(card.width, 342);
    expect(card.height, 82);
    for (final entry in [
      (id: 1, top: 222.0),
      (id: 2, top: 334.0),
      (id: 3, top: 446.0),
    ]) {
      expect(
        tester
            .getRect(
              find.byKey(
                ValueKey('customer-order-card.${summary(entry.id).id}'),
              ),
            )
            .top,
        entry.top,
      );
    }
    final storefront = tester.getRect(
      find.byKey(ValueKey('customer-order-storefront.${summary(1).id}')),
    );
    expect(storefront, const Rect.fromLTWH(36, 233, 60, 60));
    expect(
      tester.getRect(find.byKey(const ValueKey('history-filter-all.visual'))),
      const Rect.fromLTWH(24, 137, 86, 30),
    );
    expect(
      tester.getRect(
        find.byKey(const ValueKey('history-filter-active.visual')),
      ),
      const Rect.fromLTWH(122, 137, 140, 30),
    );
    expect(
      tester.getRect(find.byKey(const ValueKey('history-filter-all'))).height,
      48,
    );
    expect(find.text('BitPOS Coffee House'), findsNWidgets(3));
    expect(find.text('Today'), findsOneWidget);
    expect(find.textContaining('Yesterday'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'large Thai narrow card distinguishes payment, merchant and preparation',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(320, 1000));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      var opened = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: MediaQuery(
            data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
            child: Scaffold(
              body: SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: CustomerOrderCard(
                    order: summary(1),
                    thai: true,
                    onOpen: () => opened++,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      expect(find.text('BitPOS Coffee House'), findsOneWidget);
      expect(find.textContaining('รับแล้ว'), findsOneWidget);
      expect(find.textContaining('2.70 USD'), findsOneWidget);
      await tester.tap(find.byType(CustomerOrderCard));
      expect(opened, 1);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'older owned order remains reachable after page failure and retry',
    (tester) async {
      final api = HistoryApi();
      addTearDown(api.close);
      String? selected;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  selected = await showModalBottomSheet<String>(
                    context: context,
                    isScrollControlled: true,
                    builder: (context) => OrderHistorySheet(
                      api: api,
                      firstPage: api.firstPage(),
                      thai: false,
                      onAuthenticationRequired: () {},
                    ),
                  );
                },
                child: const Text('History'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('History'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Older orders'));
      await tester.pumpAndSettle();
      expect(find.text('History unavailable'), findsNothing);
      expect(
        find.text('Could not load history. Retry the desired page.'),
        findsOneWidget,
      );
      await tester.tap(find.text('Older orders'));
      await tester.pumpAndSettle();
      expect(
        find.text('Could not load history. Retry the desired page.'),
        findsNothing,
      );
      final list = tester.widget<ListView>(find.byType(ListView));
      expect(list.childrenDelegate.estimatedChildCount, 61);
      final older = find.byKey(ValueKey('customer-order-card.${id(31)}'));
      await tester.scrollUntilVisible(
        older,
        300,
        scrollable: find.descendant(
          of: find.byType(ListView),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.drag(find.byType(ListView), const Offset(0, -180));
      await tester.pumpAndSettle();
      await tester.tap(older);
      await tester.pumpAndSettle();
      expect(selected, id(31));
    },
  );
  testWidgets(
    'activity filters completed orders and keeps current in-progress orders',
    (tester) async {
      final api = HistoryApi();
      addTearDown(api.close);
      final completed = summary(1);
      final active = MobileFoodOrderSummary(
        id: id(2),
        merchantId: id(100),
        branchId: id(101),
        merchantName: 'BitPOS Coffee House',
        createdAt: DateTime.now().toUtc().toIso8601String(),
        status: 'PAID',
        acceptanceStatus: 'ACCEPTED',
        fulfillmentStatus: 'PREPARING',
        total: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270'),
      );
      final page = MobileFoodOrders(
        orders: [active, completed],
        nextCursor: null,
      );
      await tester.pumpWidget(
        MaterialApp(
          home: OrderHistorySheet(
            api: api,
            firstPage: page,
            thai: false,
            onAuthenticationRequired: () {},
          ),
        ),
      );
      expect(find.text('In progress'), findsOneWidget);
      expect(find.byType(CustomerOrderCard), findsNWidgets(2));
      await tester.tap(find.text('In progress'));
      await tester.pumpAndSettle();
      expect(find.byType(CustomerOrderCard), findsOneWidget);
      expect(
        find.byKey(ValueKey('customer-order-card.${id(2)}')),
        findsOneWidget,
      );
      expect(find.text('Today'), findsOneWidget);
      await tester.tap(find.text('All'));
      await tester.pumpAndSettle();
      expect(find.byType(CustomerOrderCard), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    },
  );
}
