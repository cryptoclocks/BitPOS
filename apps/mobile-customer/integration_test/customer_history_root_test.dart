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
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('U23 root activity renders the owned local API order', (
    tester,
  ) async {
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
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
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

    await ready(find.text('Home'));
    await tester.tap(find.text('Activity'));
    await ready(find.byType(OrderHistorySheet));
    await ready(find.text('Your activity'));
    await ready(find.text(merchantName));
    await tester.pumpAndSettle();
    for (final id in orderIds) {
      expect(find.byKey(ValueKey('customer-order-card.$id')), findsOneWidget);
    }
    expect(find.text(merchantName), findsNWidgets(3));
    expect(find.text('Today'), findsOneWidget);
    expect(find.textContaining('Yesterday'), findsOneWidget);
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final oldDate = DateTime.now().subtract(const Duration(days: 9));
    expect(
      find.textContaining('${oldDate.day} ${months[oldDate.month - 1]}'),
      findsOneWidget,
    );
    expect(find.text('In progress'), findsOneWidget);
    Rect rect(Finder finder) {
      final value = tester.getRect(finder);
      return value;
    }

    final filter = rect(
          find.byKey(const ValueKey('history-filter-all.visual')),
        ),
        card = rect(find.byKey(ValueKey('customer-order-card.$orderId'))),
        storefront = rect(
          find.byKey(ValueKey('customer-order-storefront.$orderId')),
        ),
        title = rect(find.text('Your activity')),
        navigation = rect(find.byType(NavigationBar));
    final geometry = {
      'viewportLogical': {
        'width': tester.view.physicalSize.width / tester.view.devicePixelRatio,
        'height':
            tester.view.physicalSize.height / tester.view.devicePixelRatio,
      },
      'viewPaddingLogical': {
        'top': tester.view.viewPadding.top / tester.view.devicePixelRatio,
        'bottom': tester.view.viewPadding.bottom / tester.view.devicePixelRatio,
      },
      'mediaPaddingLogical': {
        'top': MediaQuery.of(tester.element(find.byType(OrderHistorySheet)))
            .padding
            .top,
        'bottom': MediaQuery.of(tester.element(find.byType(OrderHistorySheet)))
            .padding
            .bottom,
      },
      'title': {'left': title.left, 'top': title.top, 'width': title.width},
      'filterAll': {
        'left': filter.left,
        'top': filter.top,
        'width': filter.width,
        'height': filter.height,
      },
      'card': {
        'left': card.left,
        'top': card.top,
        'width': card.width,
        'height': card.height,
      },
      'storefront': {
        'left': storefront.left,
        'top': storefront.top,
        'width': storefront.width,
        'height': storefront.height,
      },
      'navigation': {
        'left': navigation.left,
        'top': navigation.top,
        'width': navigation.width,
        'height': navigation.height,
      },
    };
    final viewportHeight =
        tester.view.physicalSize.height / tester.view.devicePixelRatio;
    final safeAreaNormalization =
        tester.view.viewPadding.top / tester.view.devicePixelRatio - 24;
    expect(navigation.height, closeTo(86, 0.5));
    expect(navigation.top, closeTo(viewportHeight - 86, 0.5));
    expect(filter.top - safeAreaNormalization, closeTo(133, 1));
    expect(card.top - safeAreaNormalization, closeTo(224, 2));
    expect(storefront.top - safeAreaNormalization, closeTo(235, 2));
    debugPrint('BITPOS_U23_GEOMETRY:${jsonEncode(geometry)}');
    debugPrint('BITPOS_U23_ACTIVITY_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.tap(find.byKey(const ValueKey('history-filter-active')));
    await tester.pumpAndSettle();
    expect(find.text(merchantName), findsNWidgets(3));
    expect(tester.takeException(), isNull);
    binding.reportData = {
      'status': 'PASS_NATIVE_U23_ROOT_ACTIVITY_LOCAL_API',
      'orderIds': orderIds,
      'merchantName': merchantName,
      'serverOwnedOrder': true,
      'geometry': geometry,
      'physicalTesting': 'deferred_by_user_2026-10-16',
      'limits': [
        'Synthetic local order and identity; no payment or production data',
      ],
    };
  });
}
