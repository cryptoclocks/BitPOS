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

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'U22 root reads persisted canonical order snapshot through local HTTP API',
    (tester) async {
      if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
        throw StateError('Local fixture required');
      }
      const orderId = String.fromEnvironment('BITPOS_TEST_ORDER_ID');
      final orderIds = (jsonDecode(
        utf8.decode(
          base64Decode(const String.fromEnvironment('BITPOS_TEST_ORDER_IDS')),
        ),
      ) as List<dynamic>).cast<String>();
      expect(orderIds, hasLength(3));
      const merchantName = String.fromEnvironment('BITPOS_TEST_MERCHANT_NAME');
      FlutterSecureStorage.setMockInitialValues({
        'bitpos.mobileSession': utf8.decode(
          base64Decode(
            const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'),
          ),
        ),
        'bitpos.deviceId': const String.fromEnvironment(
          'BITPOS_TEST_DEVICE_ID',
        ),
      });
      final api = MobileApi(
        base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
        fixture: true,
      );
      addTearDown(api.close);
      await tester.runAsync(api.restore);
      expect(api.signedIn, isTrue);
      final page = await tester.runAsync(() => api.foodOrders());
      expect(page!.orders.map((order) => order.id).toList(), orderIds);
      expect(
        page.orders.every((order) => order.merchantName == merchantName),
        isTrue,
      );

      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: BitPosTheme.light(),
          home: CustomerSessionPage(api: api, pushNative: PushNative()),
        ),
      );
      Future<void> ready(Finder finder) async {
        final deadline = DateTime.now().add(const Duration(seconds: 45));
        while (finder.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 100));
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 100)),
          );
        }
        expect(finder, findsWidgets);
      }

      await ready(find.text('Order'));
      await tester.tap(find.text('Orders'));
      await ready(find.byType(OrderHistorySheet));
      final card = find.byKey(ValueKey('customer-order-card.$orderId'));
      await ready(card);
      await tester.tap(card);
      await ready(find.text('Order details'));
      await ready(find.textContaining('Fixture food'));
      await tester.pumpAndSettle();
      expect(find.text('Order details'), findsOneWidget);
      expect(find.text('BitPOS'), findsNothing);
      expect(find.text('Food subtotal'), findsOneWidget);
      expect(find.text('Total'), findsOneWidget);
      expect(find.text('2.70 USD'), findsWidgets);
      expect(find.text('Track delivery'), findsNothing);
      expect(find.textContaining('Merchant acceptance'), findsOneWidget);
      final snapshot = await tester.runAsync(() => api.foodOrder(orderId));
      expect(snapshot!.id, orderId);
      expect(snapshot.total.amountMinor, '270');
      expect(snapshot.configured!.lines.single.qty, 1);
      expect(snapshot.configured!.lines.single.lineTotal.amountMinor, '270');
      expect(snapshot.status, isNot('PAID'));
      debugPrint(
        'BITPOS_U22_HTTP_GEOMETRY:${jsonEncode({'orderId': orderId, 'totalMinor': snapshot.total.amountMinor, 'configuredLines': snapshot.configured!.lines.length})}',
      );
      debugPrint('BITPOS_U22_HTTP_DETAIL_VISIBLE');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 500)),
      );
      await tester.tap(find.byTooltip('Back to orders'));
      await ready(card);
      expect(tester.takeException(), isNull);
    },
  );
}
