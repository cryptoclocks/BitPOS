import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/order_history_sheet.dart';
import '../test/notification_owner_test.dart' show PushNative;

// Synthetic account bootstrap; order/estimate reads use the owned real local API.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('customer root shows the merchant-persisted preparation estimate', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
      throw StateError('Local fixture required');
    }
    const orderId = String.fromEnvironment('BITPOS_TEST_ORDER_ID');
    const minutes = int.fromEnvironment('BITPOS_TEST_PREPARATION_MINUTES');
    expect(orderId, isNotEmpty);
    expect(minutes, greaterThan(0));
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))),
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
    });
    final api = MobileApi(base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')), fixture: true);
    addTearDown(api.close);
    await tester.runAsync(api.restore);
    final order = await tester.runAsync(() => api.foodOrder(orderId));
    expect(order!.preparation?.minutes, minutes);
    final account = await tester.runAsync(api.account);
    expect(account!.locale, 'en');
    // Let the actual root construct its own cold HTTP client and restore session.
    await tester.pumpWidget(MaterialApp(debugShowCheckedModeBanner: false, theme: BitPosTheme.light(), home: CustomerSessionPage(pushNative: PushNative())));
    Future<void> ready(Finder finder) async {
      final deadline = DateTime.now().add(const Duration(seconds: 45));
      while (finder.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      }
      expect(finder, findsWidgets, reason: finder.evaluate().isEmpty ? 'Visible fixture UI: ${tester.widgetList<Text>(find.byType(Text)).map((text) => text.data).whereType<String>().take(40).join(' | ')}' : null);
    }
    Future<void> tap(Finder finder) async {
      await ready(finder);
      await tester.ensureVisible(finder.first);
      await tester.pump(const Duration(milliseconds: 350));
      await tester.tap(finder.first);
      await tester.pump(const Duration(milliseconds: 350));
    }
    await ready(find.text('Order'));
    await tap(find.text('Orders'));
    await ready(find.byType(OrderHistorySheet));
    await tap(find.byKey(ValueKey('customer-order-card.$orderId')));
    await ready(find.text('Order details'));
    final estimate = find.textContaining('Estimated preparation: $minutes minutes');
    await ready(estimate);
    await tester.ensureVisible(estimate.first);
    await tester.pump();
    expect(estimate.hitTestable(), findsOneWidget);
    expect(tester.takeException(), isNull);
    debugPrint('BITPOS_PREPARATION137_NATIVE_PERSISTED_ESTIMATE_PASS');
  });
}
