import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:mobile_shared/food_cancellation_review_mutation.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';
import 'package:bitpos_customer/food_cancellation_review_page.dart';

import 'food_owner_test.dart' show OwnerApi;
import 'food_history_test.dart' as history_fixture;
import 'food_delivery_test.dart' as delivery_fixture;

class NavigationApi extends OwnerApi {
  int favouriteReads = 0;
  @override
  Future<MobileFoodOrders> foodOrders({String? cursor}) async =>
      MobileFoodOrders(orders: [], nextCursor: null);
  @override
  Future<MobileFavourites> favourites({String? cursor}) async {
    favouriteReads++;
    return MobileFavourites(items: [], nextCursor: null);
  }
}

class RootChatApi extends NavigationApi {
  final cancellationCommands = <FoodCancellationReviewMutation>[];
  List<FoodCancellationReview> cancellationReviews = [];
  String customerShipmentState = 'AT_DROPOFF';
  @override
  bool get signedIn => true;
  @override
  Future<FoodDispatchMutation?> pendingFoodDispatch() async => null;
  final delivery = MobileFoodDeliverySnapshot(
    addressId: history_fixture.id(201),
    addressVersion: '1',
    policyVersionId: history_fixture.id(202),
    recipientName: 'Fixture recipient',
    phone: '+66900000001',
    addressText: 'Synthetic destination',
    instructions: '',
    latitudeE7: 137560000,
    longitudeE7: 1005018000,
    deliveryFee: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
    serviceFee: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
    fixture: true,
  );
  final configured = MobileConfiguredFoodSnapshot(
    lines: [
      MobileConfiguredFoodLine(
        lineId: history_fixture.id(400),
        productId: history_fixture.id(102),
        name: 'ลาเต้ทดสอบ',
        nameEn: 'Fixture latte',
        qty: 1,
        priceVersion: history_fixture.id(401),
        optionVersion: null,
        selections: [],
        allergyNote: null,
        productBasePrice: MobileMoney(
          currency: 'USD',
          decimals: 2,
          amountMinor: '300',
        ),
        productUnitPrice: MobileMoney(
          currency: 'USD',
          decimals: 2,
          amountMinor: '300',
        ),
        optionsUnitPrice: MobileMoney(
          currency: 'USD',
          decimals: 2,
          amountMinor: '0',
        ),
        basePrice: MobileMoney(
          currency: 'USD',
          decimals: 2,
          amountMinor: '300',
        ),
        unitPrice: MobileMoney(
          currency: 'USD',
          decimals: 2,
          amountMinor: '300',
        ),
        lineTotal: MobileMoney(
          currency: 'USD',
          decimals: 2,
          amountMinor: '300',
        ),
      ),
    ],
    subtotal: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '300'),
    discount: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '30'),
    fees: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
    tax: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
    total: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270'),
  );
  MobileFoodOrder get deliveredOrder => MobileFoodOrder.fromJson({
    ...history_fixture.order(1).toJson(),
    'delivery': delivery.toJson(),
    'configured': configured.toJson(),
  });
  @override
  Future<MobileFoodOrders> foodOrders({String? cursor}) async =>
      MobileFoodOrders(orders: [history_fixture.summary(1)], nextCursor: null);
  @override
  Future<MobileFoodOrder> foodOrder(String id) async => deliveredOrder;
  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async =>
      MobileFoodEvents(order: deliveredOrder, events: [], nextCursor: null);
  @override
  Future<FoodCustomerWork> foodCustomerWork(String orderId) async {
    final current = delivery_fixture.work(2, proof: true);
    if (customerShipmentState == 'AT_DROPOFF') return current;
    return FoodCustomerWork.fromJson({
      ...current.toJson(),
      'state': customerShipmentState,
      'assignment': null,
      'dispatch': {...current.dispatch.toJson(), 'phase': 'CLOSED'},
    });
  }

  @override
  Future<FoodCancellationReviewOwnPage> foodCancellationReviews(
    String orderId,
  ) async => FoodCancellationReviewOwnPage(
    items: cancellationReviews,
    historyLimit: 20,
    shipmentVersion: '1',
    shipmentState: 'AT_DROPOFF',
  );
  @override
  Future<FoodCancellationReviewMutation?> pendingCancellationReview() async =>
      null;
  @override
  Future<FoodCancellationReviewReceipt> submitCancellationReview(
    FoodCancellationReviewMutation mutation,
  ) async {
    cancellationCommands.add(mutation);
    final review = FoodCancellationReviewOpen(
      reviewId: history_fixture.id(500),
      shipmentId: mutation.shipmentId,
      reviewVersion: '1',
      reasonCode: mutation.command.reasonCode,
      requestedShipmentVersion: mutation.command.expectedVersion,
      requestedShipmentState: 'AT_DROPOFF',
      requestedAt: '2026-10-20T01:00:00Z',
      state: 'OPEN',
    );
    cancellationReviews = [review];
    return FoodCancellationReviewReceipt(
      review: review,
      shipmentVersion: '2',
      orderCancelled: false,
      refundExecuted: false,
      custodyReleased: false,
      stockReturned: false,
    );
  }

  @override
  Future<FoodChatReadReceipt> markFoodChatRead(
    String assignmentId,
    String lastReadSequence,
  ) async => FoodChatReadReceipt(
    assignmentId: assignmentId,
    lastReadSequence: lastReadSequence,
    updatedAt: '2026-10-20T01:00:00Z',
  );
  @override
  Stream<FoodRealtimeState<FoodChatRealtimeSnapshot>> watchFoodChat(
    String assignmentId,
  ) => const Stream.empty();
  @override
  Future<FoodChatSendCommand?> pendingFoodChatMessage(
    String assignmentId,
  ) async => null;
  @override
  Future<FoodChatPage> foodChat(
    String assignmentId, {
    String afterSequence = '0',
    String? beforeSequence,
  }) async => FoodChatPage(
    assignmentId: assignmentId,
    myRole: 'CUSTOMER',
    items: [
      FoodChatMessage(
        attachments: const [],
        id: history_fixture.id(300),
        assignmentId: assignmentId,
        commandId: history_fixture.id(301),
        sequence: '1',
        senderRole: 'DRIVER',
        mine: false,
        body: 'Rider fixture: order received.\nETA about 10 minutes.',
        createdAt: '2026-10-20T02:49:00Z',
      ),
      FoodChatMessage(
        attachments: const [],
        id: history_fixture.id(302),
        assignmentId: assignmentId,
        commandId: history_fixture.id(303),
        sequence: '2',
        senderRole: 'CUSTOMER',
        mine: true,
        body: 'Thank you.\nPlease leave it by the door.',
        createdAt: '2026-10-20T02:49:00Z',
      ),
    ],
    nextAfterSequence: null,
    nextBeforeSequence: null,
    latestSequence: '2',
  );
}

void main() {
  testWidgets('U24 reason cards follow the FigCraft grid at 390 by 844', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final api = RootChatApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: FoodCancellationReviewPage(
          api: api,
          orderId: history_fixture.id(1),
          shipmentId: history_fixture.id(1),
          thai: false,
          owner: null,
          onAuthenticationRequired: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    final first = tester.getRect(
      find.byKey(const ValueKey('food-cancellation-reason.CHANGE_OF_PLANS')),
    );
    final second = tester.getRect(
      find.byKey(const ValueKey('food-cancellation-reason.LATE_ORDER')),
    );
    expect(first.left, 24);
    expect(first.width, 342);
    expect(first.height, 82);
    expect(second.top - first.bottom, 22);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'U22 order detail renders the immutable configured price snapshot',
    (tester) async {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      final api = RootChatApi(), navigation = FoodPageNavigation();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                navigation: navigation,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final opened = navigation.showOrders();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(
        find.byKey(ValueKey('customer-order-card.${history_fixture.id(1)}')),
      );
      await tester.pumpAndSettle();
      await opened;
      expect(find.textContaining('Fixture latte'), findsOneWidget);
      expect(find.text('Food subtotal'), findsOneWidget);
      expect(find.text('Delivery fee'), findsOneWidget);
      expect(find.text('Service fee'), findsOneWidget);
      expect(find.textContaining('−0.30 USD'), findsOneWidget);
      expect(find.textContaining('2.70 USD'), findsWidgets);
      expect(find.text('Synthetic destination'), findsOneWidget);
      expect(find.text('Track delivery'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'U24 submits a server-authoritative review request without claiming cancellation',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      final api = RootChatApi(), navigation = FoodPageNavigation();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                navigation: navigation,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final opened = navigation.showOrders();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(
        find.byKey(ValueKey('customer-order-card.${history_fixture.id(1)}')),
      );
      await tester.pumpAndSettle();
      await opened;
      final request = find.text('Request cancellation review');
      await tester.ensureVisible(request);
      await tester.tap(request);
      await tester.pumpAndSettle();
      expect(find.text('Cancel order'), findsOneWidget);
      expect(find.textContaining('does not cancel the order'), findsWidgets);
      await tester.tap(find.text('Taking longer than expected'));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('food-cancellation-review-detail')),
        'Synthetic delay details',
      );
      final send = find.byKey(const ValueKey('food-cancellation-review-send'));
      await tester.ensureVisible(send);
      await tester.tap(send);
      await tester.pumpAndSettle();
      expect(api.cancellationCommands, hasLength(1));
      expect(api.cancellationCommands.single.orderId, history_fixture.id(1));
      expect(api.cancellationCommands.single.shipmentId, history_fixture.id(1));
      expect(api.cancellationCommands.single.command.reasonCode, 'LATE_ORDER');
      expect(
        find.textContaining('Request recorded. The order is not cancelled'),
        findsOneWidget,
      );
      expect(find.textContaining('Awaiting review'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'U24 does not open a cancellation request after the shipment is delivered',
    (tester) async {
      final api = RootChatApi()..customerShipmentState = 'DELIVERED';
      final navigation = FoodPageNavigation();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                navigation: navigation,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final opened = navigation.showOrders();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(
        find.byKey(ValueKey('customer-order-card.${history_fixture.id(1)}')),
      );
      await tester.pumpAndSettle();
      await opened;
      final request = find.text('Request cancellation review');
      await tester.ensureVisible(request);
      await tester.tap(request);
      await tester.pumpAndSettle();
      expect(
        find.textContaining('not eligible for a cancellation review request'),
        findsOneWidget,
      );
      expect(find.text('Cancel order'), findsNothing);
      expect(api.cancellationCommands, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'actual customer root replaces delivery chat with Orders history when selected',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      tester.view.padding = FakeViewPadding(
        top: 52 * tester.view.devicePixelRatio,
        bottom: 24 * tester.view.devicePixelRatio,
      );
      addTearDown(() {
        tester.view.resetPadding();
        return tester.binding.setSurfaceSize(null);
      });
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      final api = RootChatApi(), navigation = FoodPageNavigation();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                navigation: navigation,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final history = navigation.showOrders();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(
        find.byKey(ValueKey('customer-order-card.${history_fixture.id(1)}')),
      );
      await tester.pumpAndSettle();
      await history;
      final track = find.widgetWithText(FilledButton, 'Track delivery');
      await tester.ensureVisible(track);
      await tester.tap(track);
      await tester.pumpAndSettle();
      expect(find.byType(FoodDeliveryPage), findsOneWidget);
      final chat = find.text('Chat with rider');
      expect(
        chat,
        findsOneWidget,
        reason: tester
            .widgetList<Text>(find.byType(Text))
            .map((text) => text.data)
            .join(' | '),
      );
      await tester.ensureVisible(chat);
      await tester.tap(chat);
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Rider fixture: order received.'),
        findsOneWidget,
      );
      expect(find.textContaining('Thank you.'), findsOneWidget);
      final header = tester.getRect(
        find.byKey(const ValueKey('food-chat-assignment-header')),
      );
      final backButton = tester.getRect(
        find.byKey(const ValueKey('food-chat-back-visual')),
      );
      final chatTitle = tester.getRect(find.text('Chat with rider'));
      final composer = tester.getRect(
        find.byKey(const ValueKey('food-chat-composer')),
      );
      final composerField = tester.getRect(
        find.descendant(
          of: find.byKey(const ValueKey('food-chat-composer')),
          matching: find.byType(TextField),
        ),
      );
      final send = tester.getRect(find.byTooltip('Send message'));
      final navigationRect = tester.getRect(find.byType(NavigationBar));
      expect(header.left, closeTo(24, 0.5));
      expect(header.top, closeTo(132, 0.5));
      expect(header.width, closeTo(342, 0.5));
      expect(header.height, closeTo(82, 0.5));
      expect(backButton.left, closeTo(18, 0.5));
      expect(backButton.top, closeTo(52, 0.5));
      expect(backButton.width, closeTo(44, 0.5));
      expect(backButton.height, closeTo(44, 0.5));
      expect(chatTitle.left, closeTo(76, 0.5));
      expect(composerField.left, closeTo(24, 0.5));
      expect(composerField.top, closeTo(651, 0.5));
      expect(composerField.width, closeTo(282, 0.5));
      expect(composerField.height, closeTo(52, 0.5));
      expect(send.left, closeTo(320, 0.5));
      expect(send.top, closeTo(651, 0.5));
      expect(send.width, closeTo(46, 0.5));
      expect(send.height, closeTo(52, 0.5));
      expect(navigationRect.height, closeTo(62, 0.5));
      debugPrint(
        'BITPOS_U29_ROOT_GEOMETRY:${backButton.toString()},${chatTitle.toString()},${header.toString()},${composer.toString()},${composerField.toString()},${send.toString()},${navigationRect.toString()}',
      );
      await tester.tap(find.text('Orders'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Rider fixture: order received.'),
        findsNothing,
      );
      expect(find.text('Your activity'), findsOneWidget);
      expect(find.byType(FoodDeliveryPage), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'root favourites delegate opens actual owned sheet and detaches on disposal',
    (tester) async {
      final api = NavigationApi(),
          navigation = FoodPageNavigation(),
          owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                owner: owner,
                navigation: navigation,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final opened = navigation.showFavourites();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('Your favourites'), findsOneWidget);
      expect(api.favouriteReads, 1);
      owner.value = false;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await opened;
      expect(find.text('Your favourites'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      await navigation.showFavourites();
      expect(api.favouriteReads, 1);
    },
  );
  testWidgets(
    'favourites account destination closes its owned page before opening account',
    (tester) async {
      final api = NavigationApi(), navigation = FoodPageNavigation();
      int accountOpens = 0;
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                navigation: navigation,
                onAccount: () async {
                  accountOpens++;
                },
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final opened = navigation.showFavourites();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(find.text('Account'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await opened;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(accountOpens, 1);
      expect(find.text('Your favourites'), findsNothing);
    },
  );

  testWidgets(
    'history switches to favourites and owner loss removes destination',
    (tester) async {
      final api = NavigationApi(),
          navigation = FoodPageNavigation(),
          owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                owner: owner,
                navigation: navigation,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final opened = navigation.showOrders();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('Your activity'), findsOneWidget);
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        1,
      );
      await tester.tap(find.text('Favourites'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('My orders'), findsNothing);
      expect(find.text('Your favourites'), findsOneWidget);
      owner.value = false;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await opened;
      expect(find.text('Your favourites'), findsNothing);
    },
  );

  testWidgets(
    'account handoff releases food action lock for next destination',
    (tester) async {
      final api = NavigationApi(),
          navigation = FoodPageNavigation(),
          owner = ValueNotifier(true);
      Future<void>? history;
      addTearDown(api.close);
      addTearDown(owner.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                owner: owner,
                navigation: navigation,
                onAccount: () async {
                  history = navigation.showOrders();
                },
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final opened = navigation.showFavourites();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(find.text('Account'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await opened;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      expect(find.text('Your activity'), findsOneWidget);
      owner.value = false;
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 350));
      await history;
      expect(find.text('My orders'), findsNothing);
    },
  );
}
