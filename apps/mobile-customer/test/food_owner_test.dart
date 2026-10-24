import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/payment_handoff.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';

import 'food_history_test.dart' as fixture;

class OwnerApi extends MobileApi {
  OwnerApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  @override
  Stream<FoodRealtimeState<FoodCustomerRealtimeSnapshot>> watchFoodDelivery(
    String orderId,
  ) => const Stream.empty();
  final history = Completer<MobileFoodOrders>();
  final detail = Completer<MobileFoodOrder>();
  @override
  Future<MobileFoodOrder> foodOrder(String id) => detail.future;
  int remembered = 0;
  bool checkout = false;
  final writeEntered = Completer<void>(), releaseWrite = Completer<void>();
  @override
  Future<MobileBranches> branches({
    String? cursor,
    String search = '',
    String serving = 'all',
  }) async => MobileBranches(branches: [], nextCursor: null);
  @override
  Future<String?> activeFoodOrderId() async => checkout ? fixture.id(1) : null;
  @override
  Future<MobileFoodOrderRequest?> pendingFoodOrder() async => null;
  @override
  Future<MobileFoodOrders> foodOrders({String? cursor}) => history.future;
  @override
  Future<void> rememberFoodOrder(String id) async {
    remembered++;
    if (checkout) {
      writeEntered.complete();
      await releaseWrite.future;
    }
  }

  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async {
    final json = fixture.order(1).toJson();
    json['status'] = 'AWAITING_WALLET';
    json['paymentUrl'] =
        'https://pay.cashlessthailand.com/pay/${List.filled(43, 'a').join()}';
    return MobileFoodEvents(
      order: MobileFoodOrder.fromJson(json),
      events: [],
      nextCursor: null,
    );
  }
}

class DeliveryOwnerApi extends OwnerApi {
  int workReads = 0;
  @override
  Future<String?> activeFoodOrderId() async => fixture.id(1);
  @override
  Future<FoodDispatchMutation?> pendingFoodDispatch() async => null;
  @override
  Future<FoodCustomerWork> foodCustomerWork(String orderId) async {
    workReads++;
    return FoodCustomerWork(
      shipmentId: fixture.id(200),
      state: 'READY_FOR_DISPATCH',
      version: '1',
      generation: '0',
      assignment: null,
      dispatch: FoodCustomerDispatch(
        phase: 'NEEDS_ATTENTION',
        attentionReason: null,
        search: null,
        reassignment: null,
      ),
    );
  }

  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async {
    final zero = MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0');
    final delivery = MobileFoodDeliverySnapshot(
      addressId: fixture.id(201),
      addressVersion: '1',
      policyVersionId: fixture.id(202),
      recipientName: 'Fixture recipient',
      phone: '+66900000001',
      addressText: 'Synthetic destination',
      instructions: '',
      latitudeE7: 137560000,
      longitudeE7: 1005018000,
      deliveryFee: zero,
      serviceFee: zero,
      fixture: true,
    );
    return MobileFoodEvents(
      order: MobileFoodOrder.fromJson({
        ...fixture.order(1).toJson(),
        'fulfillmentStatus': 'READY',
        'fulfillmentVersion': 2,
        'delivery': delivery.toJson(),
      }),
      events: [],
      nextCursor: null,
    );
  }
}

class ProofOwnerApi extends DeliveryOwnerApi {
  bool issued = false;
  int newCommands = 0;
  final submitted = <FoodDispatchMutation>[];
  @override
  Future<FoodCustomerWork> foodCustomerWork(String orderId) async {
    workReads++;
    return FoodCustomerWork(
      shipmentId: fixture.id(200),
      state: 'AT_DROPOFF',
      version: '1',
      generation: '1',
      dispatch: FoodCustomerDispatch(
        phase: 'ASSIGNED',
        attentionReason: null,
        search: null,
        reassignment: null,
      ),
      assignment: FoodCustomerAssignment(
        serviceAvailable: true,
        id: fixture.id(203),
        state: 'AT_DROPOFF',
        generation: '1',
        leaseGeneration: '1',
        location: null,
        deliveryProof: FoodDriverProof(
          id: fixture.id(issued ? 205 : 204),
          kind: 'DELIVERY',
          expiresAt: DateTime.now()
              .add(const Duration(minutes: 5))
              .toUtc()
              .toIso8601String(),
          attemptsRemaining: 10,
        ),
      ),
    );
  }

  @override
  FoodDeliveryProofMutation deliveryProofCommand(
    FoodCustomerAssignment assignment, {
    required bool rotate,
  }) {
    newCommands++;
    return super.deliveryProofCommand(assignment, rotate: rotate);
  }

  @override
  Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
    submitted.add(command);
    issued = true;
    return FoodProofIssueReceipt(
      proofId: fixture.id(205),
      assignmentId: fixture.id(203),
      kind: 'DELIVERY',
      expiresAt: DateTime.now()
          .add(const Duration(minutes: 5))
          .toUtc()
          .toIso8601String(),
      generation: '1',
      leaseGeneration: '1',
      replayed: false,
      secretRecoveryRequired: false,
      secret: List.filled(43, 'a').join(),
    );
  }
}

Future<void> openProofConfirmation(
  WidgetTester tester,
  ProofOwnerApi api,
  ValueNotifier<bool> owner,
  VoidCallback replacementAction,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: Column(
            children: [
              TextButton(
                onPressed: replacementAction,
                child: const Text('Replacement surface action'),
              ),
              FoodPage(
                api: api,
                thai: false,
                owner: owner,
                onAuthenticationRequired: () {},
              ),
            ],
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  final tracking = find.widgetWithText(FilledButton, 'Track delivery');
  await tester.ensureVisible(tracking);
  await tester.tap(tracking);
  await tester.pumpAndSettle();
  final replace = find.widgetWithText(FilledButton, 'Replace delivery proof');
  await tester.ensureVisible(replace);
  await tester.tap(replace);
  await tester.pumpAndSettle();
  expect(find.byType(AlertDialog), findsOneWidget);
}

void main() {
  for (final invalidate in [true, false]) {
    testWidgets(
      'checkout storage continuation requires current owner invalidated=$invalidate',
      (tester) async {
        var launches = 0;
        const channel = MethodChannel('plugins.flutter.io/url_launcher');
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          channel,
          (call) async {
            if (call.method == 'launch') {
              launches++;
              return true;
            }
            return true;
          },
        );
        addTearDown(
          () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
            channel,
            null,
          ),
        );
        final api = OwnerApi()..checkout = true;
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
                  paymentHandoff: PaymentHandoff(
                    fixture: true,
                    destinationOrigin: 'http://10.0.2.2:4321',
                  ),
                  onAuthenticationRequired: () {},
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.ensureVisible(
          find.text('Open / recover original checkout'),
        );
        await tester.tap(find.text('Open / recover original checkout'));
        await tester.pump();
        expect(api.writeEntered.isCompleted, isTrue);
        if (invalidate) {
          owner.value = false;
          await tester.pumpWidget(
            const MaterialApp(home: Text('Replacement account')),
          );
        }
        api.releaseWrite.complete();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(launches, invalidate ? 0 : 1);
      },
    );
  }
  for (final invalidateBeforeResponse in [true, false]) {
    testWidgets(
      'history is owned across invalidation before response=$invalidateBeforeResponse',
      (tester) async {
        final api = OwnerApi();
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
        await tester.tap(find.byTooltip('My orders'));
        if (invalidateBeforeResponse) owner.value = false;
        api.history.complete(
          MobileFoodOrders(orders: [fixture.summary(1)], nextCursor: null),
        );
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        if (!invalidateBeforeResponse) {
          expect(find.text('Your activity'), findsOneWidget);
          owner.value = false;
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 400));
        }
        expect(find.text('My orders'), findsNothing);
        expect(api.remembered, 0);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets('history detail response cannot cross an invalidated owner', (
    tester,
  ) async {
    final api = OwnerApi();
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
    await tester.tap(find.byTooltip('My orders'));
    api.history.complete(
      MobileFoodOrders(orders: [fixture.summary(1)], nextCursor: null),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.tap(
      find.byKey(ValueKey('customer-order-card.${fixture.id(1)}')),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    owner.value = false;
    await tester.pumpWidget(
      const MaterialApp(home: Text('Replacement account')),
    );
    api.detail.complete(fixture.order(1));
    await tester.pumpAndSettle();
    expect(api.remembered, 0);
    expect(find.text('Collected at store'), findsNothing);
  });
  for (final replaceRoot in [false, true]) {
    testWidgets(
      'private tracking route closes and stops refreshing after owner loss rootReplaced=$replaceRoot',
      (tester) async {
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        final api = DeliveryOwnerApi();
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
        final tracking = find.widgetWithText(FilledButton, 'Track delivery');
        await tester.ensureVisible(tracking);
        await tester.tap(tracking);
        await tester.pumpAndSettle();
        expect(find.byType(FoodDeliveryPage), findsOneWidget);
        expect(api.workReads, 1);
        owner.value = false;
        if (replaceRoot) {
          await tester.pumpWidget(
            const MaterialApp(home: Text('Replacement account')),
          );
        }
        await tester.pumpAndSettle();
        final reads = api.workReads;
        await tester.pump(const Duration(seconds: 20));
        expect(find.byType(FoodDeliveryPage), findsNothing);
        expect(api.workReads, reads);
        expect(tester.takeException(), isNull);
      },
    );
  }
  for (final teardown in ['owner_loss', 'replace_root', 'dispose']) {
    testWidgets(
      'proof confirmation cannot survive private-route teardown $teardown',
      (tester) async {
        final api = ProofOwnerApi();
        addTearDown(api.close);
        final owner = ValueNotifier(true);
        addTearDown(owner.dispose);
        var replacementTaps = 0;
        await openProofConfirmation(
          tester,
          api,
          owner,
          () => replacementTaps++,
        );
        if (teardown != 'dispose') owner.value = false;
        if (teardown != 'owner_loss') {
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: TextButton(
                  onPressed: () => replacementTaps++,
                  child: const Text('Replacement surface action'),
                ),
              ),
            ),
          );
        }
        await tester.pumpAndSettle();
        expect(find.byType(FoodDeliveryPage), findsNothing);
        expect(find.byType(AlertDialog), findsNothing);
        expect(
          find.byWidgetPredicate((w) => w is ModalBarrier && w.dismissible),
          findsNothing,
        );
        expect(api.newCommands, 0);
        expect(api.submitted, isEmpty);
        final replacement = find.text('Replacement surface action');
        await tester.ensureVisible(replacement);
        await tester.tap(replacement);
        await tester.pump();
        expect(replacementTaps, 1);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets(
    'cancel preserves the current proof and unchanged confirmation rotates once',
    (tester) async {
      final api = ProofOwnerApi();
      addTearDown(api.close);
      final owner = ValueNotifier(true);
      addTearDown(owner.dispose);
      await openProofConfirmation(tester, api, owner, () {});
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(api.newCommands, 0);
      expect(api.submitted, isEmpty);
      await tester.tap(
        find.widgetWithText(FilledButton, 'Replace delivery proof'),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Replace'));
      await tester.pumpAndSettle();
      expect(api.newCommands, 1);
      expect(api.submitted.length, 1);
      expect(
        (api.submitted.single as FoodDeliveryProofMutation).command.rotate,
        isTrue,
      );
      expect(
        find.byWidgetPredicate(
          (w) =>
              w is SelectableText &&
              w.semanticsLabel == 'Delivery proof secret',
        ),
        findsOneWidget,
      );
      await tester.pumpWidget(const MaterialApp());
    },
  );
}
