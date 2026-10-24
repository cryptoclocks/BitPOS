import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';
import 'package:bitpos_customer/order_history_sheet.dart';
import 'package:bitpos_customer/presentation/merchant_branch_card.dart';
import 'package:bitpos_customer/presentation/food_product_card.dart';
import 'package:bitpos_customer/product_options_sheet.dart';
import '../test/notification_owner_test.dart' show PushNative;

// Explicit local E2E: storage contains a synthetic actor, all domain I/O is real.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('same owned food order through actual customer root UI', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) throw StateError('Local fixture required');
    const stage = String.fromEnvironment('BITPOS_TEST_CUSTOMER_STAGE');
    const expectedOrder = String.fromEnvironment('BITPOS_TEST_ORDER_ID');
    const branchId = String.fromEnvironment('BITPOS_TEST_BRANCH_ID');
    const productId = String.fromEnvironment('BITPOS_TEST_PRODUCT_ID');
    expect(['CREATE', 'PROOF', 'DELIVERED'], contains(stage));
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))),
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
    });
    final api = MobileApi(base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')), fixture: true);
    addTearDown(api.close);
    await tester.runAsync(api.restore);
    expect(api.signedIn, isTrue);
    addTearDown(() async {
      final session = await api.storage.read(key: 'bitpos.mobileSession');
      if (session != null) {
        await File('${Directory.systemTemp.path}/bitpos-joined-session.json').writeAsString(session, flush: true);
        debugPrint('BITPOS_JOINED_SESSION_EXPORTED');
      }
    });
    Future<void> wait(Finder finder) async {
      for (var n = 0; n < 450 && finder.evaluate().isEmpty; n++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      }
      expect(finder, findsWidgets, reason: finder.evaluate().isEmpty
          ? 'Visible fixture UI: ${tester.widgetList<Text>(find.byType(Text)).map((text) => text.data).whereType<String>().take(40).join(' | ')}'
          : null);
    }
    Future<void> tap(Finder finder) async {
      await wait(finder);
      await tester.ensureVisible(finder.first);
      await tester.pump(const Duration(milliseconds: 350));
      await wait(finder.hitTestable());
      await tester.tap(finder.first, warnIfMissed: true);
      // Settle route transitions, not an unbounded network loading animation.
      await tester.pump(const Duration(milliseconds: 350));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      await tester.pump();
    }
    Future<void> export(Map<String, String> value) async { await File('${Directory.systemTemp.path}/bitpos-joined-customer.json').writeAsString(jsonEncode(value), flush: true); }
    await tester.pumpWidget(MaterialApp(debugShowCheckedModeBanner: false, theme: BitPosTheme.light(), home: CustomerSessionPage(api: api, pushNative: PushNative())));
    await wait(find.text('Order'));
    if (stage == 'CREATE') {
      final before = await tester.runAsync(api.foodOrders);
      expect(before!.orders, isEmpty, reason: 'Fresh isolated actor, never reuse another order');
      final branch = find.byWidgetPredicate((w) => w is MerchantBranchCard && w.branch.id == branchId);
      await tap(branch);
      final product = find.byWidgetPredicate((w) => w is FoodProductCard && w.product.id == productId);
      await wait(product);
      await tap(find.widgetWithText(ChoiceChip, 'Delivery'));
      await tap(find.text('W02 joined fixture'));
      await tap(find.descendant(of: product, matching: find.text('Configure / add')));
      await wait(find.byType(ProductOptionsSheet));
      await tap(find.text('Add to cart'));
      final review = find.widgetWithText(FilledButton, 'Review cart · 1');
      await wait(review);
      final scroll = find.byKey(const ValueKey('customer-root-content-scroll'));
      for (var n = 0; n < 12 && review.hitTestable().evaluate().isEmpty; n++) {
        await tester.drag(scroll, const Offset(0, -300)); await tester.pump();
      }
      await tap(review);
      await tap(find.byKey(const ValueKey('customer-cart-review-bottom-action')));
      await tap(find.widgetWithText(FilledButton, 'Confirm delivery order'));
      await wait(find.text('Order details'));
      final page = await tester.runAsync(api.foodOrders);
      expect(page!.orders, hasLength(1));
      final order = await tester.runAsync(() => api.foodOrder(page.orders.single.id));
      expect(order!.branchId, branchId);
      expect(order.total.amountMinor, '390');
      expect(order.delivery, isNotNull);
      expect(order.acceptanceStatus, 'PENDING');
      await export({'orderId': order.id});
    } else {
      expect(expectedOrder, isNotEmpty);
      await tap(find.text('Orders'));
      await wait(find.byType(OrderHistorySheet));
      await tap(find.byKey(ValueKey('customer-order-card.$expectedOrder')));
      await wait(find.text('Order details'));
      await tap(find.text('Track delivery'));
      await wait(find.byType(FoodDeliveryPage));
      if (stage == 'PROOF') {
        await tap(find.ancestor(of: find.textContaining(RegExp(r'^(Issue|Replace) delivery proof$')), matching: find.byType(FilledButton)));
        await tester.pump(const Duration(milliseconds: 350));
        if (find.byType(AlertDialog).evaluate().isNotEmpty) {
          await tap(find.descendant(of: find.byType(AlertDialog), matching: find.widgetWithText(FilledButton, 'Replace')));
        }
        final capability = find.byWidgetPredicate((w) => w is SelectableText && w.semanticsLabel == 'Delivery proof secret');
        await wait(capability);
        final secret = tester.widget<SelectableText>(capability).data;
        expect(secret != null && RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(secret), isTrue, reason: 'Private capability shape');
        await export({'orderId': expectedOrder, 'secret': secret!});
      } else {
        await wait(find.text('Shipment: DELIVERED'));
        expect(find.descendant(of: find.byType(FoodDeliveryPage), matching: find.byType(SelectableText)), findsNothing);
        await wait(find.text('Delivered to you'));
        final delivered = await tester.runAsync(() => api.foodCustomerWork(expectedOrder));
        expect(delivered!.state, 'DELIVERED');
        await tap(find.byIcon(Icons.chevron_left));
        await tester.pump(const Duration(milliseconds: 350));
        expect(find.text('Delivered to you'), findsNothing);
      }
    }
    expect(tester.takeException(), isNull);
    debugPrint('BITPOS_JOINED_CUSTOMER_${stage}_PASS');
  });
}
