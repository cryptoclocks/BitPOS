import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/food_page.dart';

import 'food_history_test.dart' as fixture;

class TimelineApi extends MobileApi {
  TimelineApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  bool replayed = false;
  bool failReplayEvents = true;
  @override
  Future<MobileBranches> branches({
    String? cursor,
    String search = '',
    String serving = 'all',
  }) async => MobileBranches(branches: [], nextCursor: null);
  @override
  Future<String?> activeFoodOrderId() async => fixture.id(1);
  @override
  Future<MobileFoodOrderRequest?> pendingFoodOrder() async => replayed
      ? null
      : MobileFoodOrderRequest(
          branchId: fixture.id(101),
          quoteId: fixture.id(103),
          priceVersion: fixture.id(104),
          idempotencyKey: fixture.id(105),
        );
  @override
  Future<MobileFoodOrderResult> submitFoodOrder(
    MobileFoodOrderRequest command,
  ) async {
    replayed = true;
    return MobileFoodOrderResult(order: fixture.order(2), replayed: true);
  }

  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async {
    if (id == fixture.id(2) && failReplayEvents) {
      failReplayEvents = false;
      throw Exception('events offline fixture');
    }
    final a = id == fixture.id(1);
    return MobileFoodEvents(
      order: fixture.order(a ? 1 : 2),
      events: [
        MobileFoodEvent(
          id: fixture.id(a ? 201 : 202),
          sequence: '1',
          kind: 'ACCEPTANCE',
          occurredAt: '2026-10-16T00:00:00Z',
          paymentStatus: 'PAID',
          paymentVersion: 2,
          acceptanceStatus: a ? 'REJECTED' : 'ACCEPTED',
          acceptanceVersion: 1,
          fulfillmentStatus: 'RECEIVED',
          fulfillmentVersion: 0,
        ),
      ],
      nextCursor: null,
    );
  }
}

class RejectedTimelineApi extends TimelineApi {
  @override
  Future<MobileFoodOrderResult> submitFoodOrder(
    MobileFoodOrderRequest command,
  ) async {
    replayed = true;
    return MobileFoodOrderResult(
      order: MobileFoodOrder.fromJson({
        ...fixture.order(2).toJson(),
        'status': 'AWAITING_WALLET',
        'acceptanceStatus': 'PENDING',
        'acceptanceVersion': 0,
        'eventSequence': '1',
        'fulfillmentStatus': 'RECEIVED',
        'fulfillmentVersion': 0,
      }),
      replayed: true,
    );
  }

  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async {
    if (id != fixture.id(2)) return super.foodEvents(id, cursor: cursor);
    final order = MobileFoodOrder.fromJson({
      ...fixture.order(2).toJson(),
      'acceptanceStatus': 'REJECTED',
      'acceptanceReason': 'Kitchen unavailable fixture',
      'eventSequence': '8',
      'fulfillmentStatus': 'RECEIVED',
      'fulfillmentVersion': 0,
      'refunds': [
        {
          'id': fixture.id(301),
          'version': '1',
          'money': {
            'currency': 'USDG',
            'decimals': 6,
            'amountMinor': '2700000',
          },
          'status': 'REQUESTED',
          'cause': 'ONLINE_ACCEPTANCE_REJECTED',
        },
      ],
    });
    return MobileFoodEvents(order: order, events: [], nextCursor: null);
  }
}

class PhaseTimelineApi extends TimelineApi {
  PhaseTimelineApi(this.current);

  MobileFoodOrder current;

  @override
  Future<String?> activeFoodOrderId() async => current.id;

  @override
  Future<MobileFoodOrderRequest?> pendingFoodOrder() async => null;

  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async =>
      MobileFoodEvents(order: current, events: [], nextCursor: null);
}

void main() {
  testWidgets(
    'saved B replay cannot show A events when B event recovery fails',
    (tester) async {
      final api = TimelineApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Rejected by merchant'), findsOneWidget);
      await tester.ensureVisible(find.text('Recover / retry saved request'));
      await tester.tap(find.text('Recover / retry saved request'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Rejected by merchant'), findsNothing);
      expect(
        find.text(
          'Connection unavailable. If submitted, retry only the saved request.',
        ),
        findsOneWidget,
      );
      await tester.ensureVisible(find.text('Refresh server status'));
      await tester.tap(find.text('Refresh server status'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining(
          'Payment verified · Accepted by merchant · Received by store',
        ),
        findsOneWidget,
      );
    },
  );
  testWidgets(
    'successful replay adopts newer rejection and received-money obligation',
    (tester) async {
      final api = RejectedTimelineApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Recover / retry saved request'));
      await tester.tap(find.text('Recover / retry saved request'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Kitchen unavailable fixture'),
        findsOneWidget,
      );
      expect(find.textContaining('2.700000 USDG · REQUESTED'), findsOneWidget);
      expect(
        find.textContaining('This order will not be prepared.'),
        findsOneWidget,
      );
      expect(find.textContaining('Collect at the merchant.'), findsNothing);
    },
  );
  testWidgets(
    'U18 accepted and U19 preparing phases use only current server state',
    (tester) async {
      final accepted = MobileFoodOrder.fromJson({
        ...fixture.order(2).toJson(),
        'fulfillmentStatus': 'RECEIVED',
        'fulfillmentVersion': 0,
      });
      final api = PhaseTimelineApi(accepted);
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('food-order-phase.accepted')),
        findsOneWidget,
      );
      expect(find.text('Order accepted'), findsWidgets);
      expect(find.text('Preparing food'), findsOneWidget);
      expect(find.text('Rider pickup'), findsNothing);
      expect(find.text('Ready for collection'), findsOneWidget);
      api.current = MobileFoodOrder.fromJson({
        ...accepted.toJson(),
        'fulfillmentStatus': 'PREPARING',
        'fulfillmentVersion': 1,
        'preparation': {'minutes': 15, 'recordedAt': '2026-10-16T00:00:00Z'},
      });
      final refresh = find.text('Refresh server status');
      await tester.ensureVisible(refresh);
      await tester.tap(refresh);
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('food-order-phase.preparing')),
        findsOneWidget,
      );
      expect(find.text('Estimated preparation: 15 minutes'), findsOneWidget);
    },
  );

  for (final status in [
    'AWAITING_WALLET',
    'AWAITING_PAYMENT',
    'EXPIRED',
    'RECOVERY',
  ]) {
    testWidgets(
      '$status order does not claim payment checking is in progress',
      (tester) async {
        final order = MobileFoodOrder.fromJson({
          ...fixture.order(2).toJson(),
          'status': status,
          'acceptanceStatus': 'PENDING',
          'acceptanceVersion': 0,
          'fulfillmentStatus': 'RECEIVED',
          'fulfillmentVersion': 0,
        });
        final api = PhaseTimelineApi(order);
        addTearDown(api.close);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: FoodPage(
                  api: api,
                  thai: false,
                  onAuthenticationRequired: () {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Checking payment'), findsNothing);
        expect(
          find.textContaining(switch (status) {
            'AWAITING_WALLET' => 'Awaiting payment method',
            'AWAITING_PAYMENT' => 'Awaiting payment',
            'EXPIRED' => 'Order expired',
            _ => 'Payment needs review',
          }),
          findsWidgets,
        );
      },
    );
  }
}
