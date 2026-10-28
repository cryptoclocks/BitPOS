import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/food_cancellation_review_page.dart';

import '../test/food_history_test.dart' as history_fixture;
import '../test/notification_owner_test.dart' show PushNative;
import 'customer_u22_order_detail_root_test.dart' show U22RootApi;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('U24 customer root submits only an owned cancellation review', (
    tester,
  ) async {
    final api = U22RootApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: CustomerSessionPage(api: api, pushNative: PushNative()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('กิจกรรม'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(ValueKey('customer-order-card.${history_fixture.id(1)}')),
    );
    await tester.pumpAndSettle();
    final request = find.text('ตรวจยกเลิก');
    await tester.ensureVisible(request);
    await tester.pumpAndSettle();
    await tester.tap(request);
    await tester.pumpAndSettle();
    expect(find.byType(FoodCancellationReviewPage), findsOneWidget);
    final back = tester.getRect(find.byTooltip('Back'));
    final first = tester.getRect(
      find.byKey(const ValueKey('food-cancellation-reason.CHANGE_OF_PLANS')),
    );
    final second = tester.getRect(
      find.byKey(const ValueKey('food-cancellation-reason.LATE_ORDER')),
    );
    // Vertical positions are measured from the device's top safe area (44 dp on the original AVD, 54.1 dp on this one).
    final inset = tester.view.padding.top / tester.view.devicePixelRatio;
    debugPrint('BITPOS_U24_GEOMETRY:$back,$first,$second');
    expect(back.left, closeTo(18, 1));
    expect(back.top, closeTo(inset + 8, 1));
    expect(back.width, closeTo(44, 1));
    expect(first.left, closeTo(24, 1));
    expect(first.top, closeTo(inset + 96, 1));
    expect(first.width, closeTo(342, 1));
    expect(first.height, closeTo(82, 1));
    expect(second.top, closeTo(inset + 200, 1));
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('food-cancellation-review-send')),
          )
          .onPressed,
      isNull,
    );
    debugPrint('BITPOS_U24_ROOT_AVD_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 500)),
    );
    await tester.tap(
      find.byKey(const ValueKey('food-cancellation-reason.LATE_ORDER')),
    );
    final detail = find.byKey(
      const ValueKey('food-cancellation-review-detail'),
    );
    await tester.scrollUntilVisible(
      detail,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.enterText(detail, 'Synthetic native root delay request');
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    final send = find.byKey(const ValueKey('food-cancellation-review-send'));
    await tester.ensureVisible(send);
    await tester.pumpAndSettle();
    await tester.tap(send);
    await tester.pumpAndSettle();
    expect(api.cancellationCommands, hasLength(1));
    expect(api.cancellationCommands.single.command.reasonCode, 'LATE_ORDER');
    expect(api.cancellationCommands.single.orderId, history_fixture.id(1));
    expect(
      find.byKey(const ValueKey('food-cancellation-review-recorded')),
      findsOneWidget,
    );
    await tester.tap(find.byTooltip('Back'));
    await tester.pumpAndSettle();
    expect(find.byType(FoodCancellationReviewPage), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
