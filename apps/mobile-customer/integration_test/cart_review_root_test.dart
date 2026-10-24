import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/configured_food_lines.dart';
import 'package:bitpos_customer/presentation/food_product_card.dart';
import 'package:bitpos_customer/presentation/merchant_branch_card.dart';
import 'package:bitpos_customer/presentation/food_cart_line_card.dart';
import 'package:bitpos_customer/presentation/quote_price_summary.dart';
import 'package:bitpos_customer/presentation/quote_confirmation.dart';
import 'package:bitpos_customer/product_options_sheet.dart';

import '../test/notification_owner_test.dart' show PushNative;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('root U11 shows server quote and fixed bottom action before U15', (
    tester,
  ) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
      throw StateError('Local fixture only');
    }
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

    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: CustomerSessionPage(api: api, pushNative: PushNative()),
      ),
    );
    Future<void> ready(bool Function() predicate) async {
      for (var i = 0; i < 250 && !predicate(); i++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
      }
      expect(
        predicate(),
        isTrue,
        reason:
            'Root text: ${find.byType(Text).evaluate().map((e) => (e.widget as Text).data).toList()}',
      );
    }

    await ready(() => find.byType(FoodPage).evaluate().isNotEmpty);
    await ready(() => find.byType(MerchantBranchCard).evaluate().isNotEmpty);
    final availableBranches = find
        .byType(MerchantBranchCard)
        .evaluate()
        .map((element) => (element.widget as MerchantBranchCard).branch)
        .where((branch) => branch.pickupEnabled)
        .toList();
    if (availableBranches.isEmpty) {
      throw StateError('Fixture has no pickup-enabled branch');
    }
    final branch = availableBranches.first;
    final branchFinder = find.byWidgetPredicate(
      (w) => w is MerchantBranchCard && w.branch.id == branch.id,
    );
    await tester.ensureVisible(branchFinder);
    await tester.tap(branchFinder);
    await ready(() => find.byType(FoodProductCard).evaluate().isNotEmpty);
    final availableProducts = find
        .byType(FoodProductCard)
        .evaluate()
        .map((element) => (element.widget as FoodProductCard).product)
        .where(
          (product) =>
              product.unitPrice != null &&
              product.available > 0 &&
              !product.options.groups.any(
                (group) => group.enabled && group.minSelections > 0,
              ),
        )
        .toList();
    if (availableProducts.isEmpty) {
      throw StateError('Fixture branch has no selectable priced product');
    }
    final product = availableProducts.first;
    final card = find.byWidgetPredicate(
      (w) => w is FoodProductCard && w.product.id == product.id,
    );
    await tester.ensureVisible(card);
    final configure = find.descendant(
      of: card,
      matching: find.text('Configure / add'),
    );
    await tester.ensureVisible(configure);
    await tester.tap(configure);
    await ready(() => find.byType(ProductOptionsSheet).evaluate().isNotEmpty);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.ensureVisible(find.text('Add to cart'));
    await tester.tap(find.text('Add to cart'));
    await ready(() => find.byType(FoodCartLineCard).evaluate().isNotEmpty);
    final review = find.widgetWithText(FilledButton, 'Review cart · 1');
    final scrollable = find.byKey(
      const ValueKey('customer-root-content-scroll'),
    );
    for (var i = 0; i < 8; i++) {
      await tester.pumpAndSettle();
      final rect = tester.getRect(review);
      final viewport = tester.getRect(scrollable);
      if (rect.top >= viewport.top && rect.bottom <= viewport.bottom) break;
      await tester.drag(scrollable, const Offset(0, -320));
    }
    await tester.pumpAndSettle();
    final reviewRect = tester.getRect(review);
    final viewportRect = tester.getRect(scrollable);
    expect(reviewRect.top, greaterThanOrEqualTo(viewportRect.top));
    expect(reviewRect.bottom, lessThanOrEqualTo(viewportRect.bottom));
    await tester.tap(review);
    await ready(
      () => find
          .byKey(const ValueKey('customer-cart-review-bottom-action'))
          .evaluate()
          .isNotEmpty,
    );
    expect(find.text('Your cart'), findsOneWidget);
    expect(find.byType(QuotePriceSummary), findsOneWidget);
    expect(find.text('Test settlement'), findsNothing);
    expect(
      find.byKey(const ValueKey('customer-cart-review-bottom-action')),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('customer-cart-review-bottom-action')),
          )
          .onPressed,
      isNotNull,
    );
    await tester.drag(scrollable, const Offset(0, 1000));
    await tester.pumpAndSettle();
    debugPrint('BITPOS_U11_ROOT_CART_REVIEW_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    final backToMenu = find.byTooltip('Back to menu');
    await tester.ensureVisible(backToMenu);
    expect(backToMenu.hitTestable(), findsOneWidget);
    await tester.tap(backToMenu);
    await ready(() => find.text('Review cart · 1').evaluate().isNotEmpty);
    expect(find.byType(QuotePriceSummary), findsNothing);
    final reviewFromMenu = find.text('Review cart · 1');
    await tester.drag(scrollable, const Offset(0, -500));
    await tester.pumpAndSettle();
    await tester.tap(reviewFromMenu);
    await ready(
      () => find
          .byKey(const ValueKey('customer-cart-review-bottom-action'))
          .evaluate()
          .isNotEmpty,
    );
    await tester.tap(
      find.byKey(const ValueKey('customer-cart-review-bottom-action')),
    );
    await ready(() => find.byType(QuoteConfirmation).evaluate().isNotEmpty);
    tester.widget<SingleChildScrollView>(scrollable).controller!.jumpTo(0);
    await tester.pumpAndSettle();
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    expect(find.text('Review order'), findsOneWidget);
    expect(find.textContaining('Test settlement'), findsOneWidget);
    expect(find.text('Solana devnet · not real money'), findsOneWidget);
    expect(find.textContaining('Confirm'), findsOneWidget);
    final settlement = find.textContaining('Test settlement');
    final rootScaffold = find.byType(Scaffold).first;
    final rootMedia = MediaQuery.of(tester.element(rootScaffold));
    final bodyRect = tester.getRect(scrollable);
    final settlementRect = tester.getRect(settlement);
    final footerRect = tester.getRect(find.byType(QuoteConfirmation));
    final confirmRect = tester.getRect(find.text('Confirm pickup order'));
    final lineCardRect = tester.getRect(
      find
          .descendant(
            of: find.byType(ConfiguredFoodLines),
            matching: find.byType(Card),
          )
          .first,
    );
    final layout = {
      'viewportHeight': rootMedia.size.height,
      'bodyTop': bodyRect.top,
      'bodyBottom': bodyRect.bottom,
      'lineCardLeft': lineCardRect.left,
      'lineCardTop': lineCardRect.top,
      'lineCardWidth': lineCardRect.width,
      'lineCardHeight': lineCardRect.height - 12,
      'settlementTop': settlementRect.top,
      'settlementBottom': settlementRect.bottom,
      'footerTop': footerRect.top,
      'confirmBottom': confirmRect.bottom,
      'confirmBottomGap': rootMedia.size.height - confirmRect.bottom,
    };
    debugPrint('BITPOS_U15_LAYOUT ${jsonEncode(layout)}');
    expect(bodyRect.height, greaterThan(0));
    expect(settlementRect.top, greaterThanOrEqualTo(bodyRect.top));
    expect(settlementRect.bottom, lessThan(footerRect.top));
    expect(lineCardRect.left, closeTo(24, 0.5));
    expect(lineCardRect.height - 12, closeTo(82, 1));
    expect(
      rootMedia.size.height - confirmRect.bottom,
      inInclusiveRange(55, 100),
    );
    expect(tester.takeException(), isNull);
    debugPrint('BITPOS_U15_ROOT_ORDER_REVIEW_VISIBLE');
    final backToCart = find
        .ancestor(
          of: find.byTooltip('Back to cart'),
          matching: find.byType(IconButton),
        )
        .first;
    expect(backToCart.hitTestable(), findsOneWidget);
    await tester.tap(backToCart);
    await ready(() => find.text('Your cart').evaluate().isNotEmpty);
    expect(find.byType(QuotePriceSummary), findsOneWidget);
    expect(find.text('Test settlement'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });
}
