import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/payment_method_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/payment_handoff.dart';

import 'food_history_test.dart' as fixture;
import 'food_owner_test.dart' show OwnerApi;

class _PaymentFlowApi extends OwnerApi {
  int rememberedOrders = 0;
  int orderCommands = 0;
  int statusReads = 0;

  @override
  Future<String?> activeFoodOrderId() async => fixture.id(1);

  @override
  Future<void> rememberFoodOrder(String id) async {
    expect(id, fixture.id(1));
    rememberedOrders++;
  }

  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async {
    statusReads++;
    return super.foodEvents(id, cursor: cursor);
  }

  @override
  Future<MobileFoodOrderResult> submitFoodOrder(
    MobileFoodOrderRequest command,
  ) {
    orderCommands++;
    throw StateError('Payment method must never create an order');
  }
}

class _ExistingCheckout extends PaymentHandoff {
  _ExistingCheckout()
    : super(fixture: true, destinationOrigin: 'http://127.0.0.1:4321');
  int opens = 0;

  @override
  Future<void> open(String capability) async {
    destination(capability);
    opens++;
  }
}

void main() {
  testWidgets('existing order selects method and returns to refreshed order', (
    tester,
  ) async {
    final api = _PaymentFlowApi();
    final checkout = _ExistingCheckout();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: FoodPage(
              api: api,
              thai: false,
              paymentHandoff: checkout,
              onAuthenticationRequired: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final choice = find.text('Choose payment method for this order');
    expect(choice, findsWidgets);
    await tester.ensureVisible(choice.first);
    await tester.tap(choice.first);
    await tester.pumpAndSettle();
    expect(find.byType(PaymentMethodPage), findsOneWidget);
    expect(checkout.opens, 0);
    expect(api.orderCommands, 0);

    await tester.tap(find.byKey(const ValueKey('payment-method-solana')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('payment-method-continue')));
    await tester.pumpAndSettle();
    expect(find.byType(PaymentMethodPage), findsNothing);
    expect(checkout.opens, 1);
    expect(api.rememberedOrders, 1);
    expect(api.statusReads, greaterThanOrEqualTo(2));
    expect(api.orderCommands, 0);
  });
}
