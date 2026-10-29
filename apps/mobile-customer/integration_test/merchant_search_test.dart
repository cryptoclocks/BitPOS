import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/presentation/merchant_search_empty.dart';
import 'package:bitpos_customer/presentation/food_product_card.dart';
import 'package:bitpos_customer/product_options_sheet.dart';
import 'package:bitpos_customer/presentation/food_cart_line_card.dart';
import 'package:bitpos_customer/presentation/quote_price_summary.dart';
import 'package:bitpos_customer/presentation/quote_confirmation.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('actual public merchant search empty and reset on local API', (
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
    final first = await tester.runAsync(() => api.branches());
    expect(first!.branches, isNotEmpty);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: SingleChildScrollView(
                child: FoodPage(
                  api: api,
                  thai: false,
                  onAuthenticationRequired: () =>
                      fail('Fresh fixture session must remain active'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    Future<void> ready(bool Function() check) async {
      for (var n = 0; n < 200 && !check(); n++) {
        await tester.pump();
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
      }
      expect(check(), isTrue);
    }

    final search = find.byKey(const ValueKey('branch-discovery-search'));
    await ready(
      () =>
          search.evaluate().isNotEmpty &&
          tester.widget<TextField>(search).enabled == true,
    );
    await tester.ensureVisible(search);
    tester.binding.focusedEditable = null;
    await tester.enterText(search, 'zz-no-match-bitpos-native-20261020');
    expect(tester.widget<TextField>(search).controller!.text, 'zz-no-match-bitpos-native-20261020');
    final submit = find.byKey(const ValueKey('branch-discovery-submit'));
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    await ready(() => find.byType(MerchantSearchEmpty).evaluate().isNotEmpty);
    await tester.ensureVisible(find.byType(MerchantSearchEmpty));
    await tester.pumpAndSettle();
    debugPrint('BITPOS_MERCHANT_SEARCH_EMPTY_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.ensureVisible(find.text('Clear search and filters'));
    await tester.tap(find.text('Clear search and filters'));
    await ready(
      () =>
          find.byType(MerchantSearchEmpty).evaluate().isEmpty &&
          tester.widget<TextField>(search).enabled == true,
    );
    expect(tester.widget<TextField>(search).controller!.text, isEmpty);
    // The shared local fixture database holds several branches with the same English name.
    expect(find.text(first.branches.first.nameEn), findsWidgets);
    tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .jumpTo(0);
    await tester.pumpAndSettle();
    debugPrint('BITPOS_MERCHANT_SEARCH_RESET_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    if (const bool.fromEnvironment('BITPOS_TEST_PRODUCT_CARD')) {
      final menus = await tester.runAsync(() async {
        for (final branch in first.branches) {
          final menu = await api.menu(branch.id);
          if (menu.products.any(
            (p) => p.unitPrice != null && p.available > 0,
          )) {
            return menu;
          }
        }
        throw StateError('No priced available fixture product');
      });
      final branch = menus!.branch;
      final title = branch.nameEn.trim().isNotEmpty
          ? branch.nameEn
          : branch.name;
      await tester.scrollUntilVisible(
        find.text(title).first,
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.text(title).first);
      await tester.pump();
      await ready(
        () =>
            find.byType(FoodProductCard).evaluate().isNotEmpty &&
            find.byType(TextField).evaluate().isNotEmpty,
      );
      final available = find
          .byWidgetPredicate(
            (w) => w is FoodProductCard && w.onConfigure != null,
          )
          .first;
      await tester.ensureVisible(available);
      await tester.pump();
      debugPrint('BITPOS_PRODUCT_MENU_VISIBLE');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 2)),
      );
      final button = find.descendant(
        of: available,
        matching: find.byType(OutlinedButton),
      );
      await tester.ensureVisible(button);
      await tester.tap(button);
      await tester.pump();
      await ready(() => find.byType(ProductOptionsSheet).evaluate().isNotEmpty);
      await tester.pump(const Duration(milliseconds: 500));
      debugPrint('BITPOS_PRODUCT_OPTIONS_VISIBLE');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 2)),
      );
      if (const bool.fromEnvironment('BITPOS_TEST_CART_LINE')) {
        final sheet = tester.widget<ProductOptionsSheet>(
          find.byType(ProductOptionsSheet),
        );
        expect(
          sheet.options.groups.where((g) => g.enabled && g.minSelections > 0),
          isEmpty,
          reason: 'This local cart fixture requires a product without mandatory options',
        );
        await tester.ensureVisible(find.byTooltip('Increase product quantity'));
        await tester.tap(find.byTooltip('Increase product quantity'));
        await tester.pump();
        final note = find.byType(TextField).last;
        await tester.ensureVisible(note);
        tester.binding.focusedEditable = null;
        await tester.enterText(note, 'Synthetic cart note');
        FocusManager.instance.primaryFocus?.unfocus();
        await tester.pump();
        await tester.tap(find.byKey(const ValueKey('product-detail-submit')));
        await tester.pump();
        await ready(
          () =>
              find.byType(ProductOptionsSheet).evaluate().isEmpty &&
              find.byType(FoodCartLineCard).evaluate().isNotEmpty,
        );
        await tester.ensureVisible(find.byType(FoodCartLineCard));
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<FoodCartLineCard>(find.byType(FoodCartLineCard))
              .item
              .qty,
          2,
        );
        expect(find.text('Synthetic cart note'), findsOneWidget);
        debugPrint('BITPOS_CART_LINE_VISIBLE');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 2)),
        );
        await tester.tap(find.text('Edit item'));
        await tester.pump();
        await ready(
          () => find.byType(ProductOptionsSheet).evaluate().isNotEmpty,
        );
        await tester.pump(const Duration(milliseconds: 500));
        expect(
          tester
              .widget<TextField>(find.byType(TextField).last)
              .controller!
              .text,
          'Synthetic cart note',
        );
        await tester.ensureVisible(find.byTooltip('Decrease product quantity'));
        await tester.tap(find.byTooltip('Decrease product quantity'));
        await tester.pump();
        await tester.tap(find.byKey(const ValueKey('product-detail-submit')));
        await tester.pump();
        await ready(() => find.byType(ProductOptionsSheet).evaluate().isEmpty);
        expect(
          tester
              .widget<FoodCartLineCard>(find.byType(FoodCartLineCard))
              .item
              .qty,
          1,
        );
        if (const bool.fromEnvironment('BITPOS_TEST_QUOTE')) {
          await tester.ensureVisible(find.text('Review cart · 1'));
          await tester.tap(find.text('Review cart · 1'));
          await tester.pump();
          await ready(() => find.byType(QuotePriceSummary).evaluate().isNotEmpty);
          await tester.ensureVisible(find.byType(QuotePriceSummary));
          await tester.pumpAndSettle();
          expect(find.text('Price summary'), findsOneWidget);
          expect(find.byType(QuoteConfirmation), findsOneWidget);
          debugPrint('BITPOS_QUOTE_SUMMARY_VISIBLE');
          await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
          await tester.ensureVisible(find.text('Edit cart'));
          await tester.tap(find.text('Edit cart'));
          await tester.pump();
          await ready(() => find.byType(QuotePriceSummary).evaluate().isEmpty);
        }
        await tester.ensureVisible(find.text('Remove item'));
        await tester.tap(find.text('Remove item'));
        await tester.pump();
        await ready(() => find.byType(FoodCartLineCard).evaluate().isEmpty);
        expect(find.text('Review cart · 0'), findsOneWidget);
      } else {
        await tester.tap(find.byKey(const ValueKey('product-detail-back')));
        await tester.pump();
        await ready(() => find.byType(ProductOptionsSheet).evaluate().isEmpty);
      }
    }
    await tester.runAsync(api.logout);
    expect(api.signedIn, isFalse);
    expect(tester.takeException(), isNull);
  });
}
