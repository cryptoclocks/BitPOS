import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_customer/configured_food_lines.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/presentation/food_product_card.dart';
import 'package:bitpos_customer/presentation/merchant_branch_card.dart';
import 'package:bitpos_customer/presentation/quote_confirmation.dart';
import 'package:bitpos_customer/presentation/quote_price_summary.dart';
import 'package:bitpos_customer/product_options_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_cart_review_stage_test.dart' show CartReviewApi, id;
import 'notification_owner_test.dart' show PushNative;
import 'product_options_test.dart' as options_fixture;

/// UI-only authorized synthetic session/menu/quote. Never performs HTTP or an order.
class SurfaceFoodApi extends CartReviewApi {
  SurfaceFoodApi(this.thai);
  final bool thai;
  int quoteRequests = 0;
  @override
  bool get signedIn => true;
  @override
  ({String accountId, String sessionId}) get sessionScope =>
      (accountId: id(90), sessionId: id(91));
  @override
  Stream<({String accountId, String sessionId})?> get sessionScopes =>
      const Stream.empty();
  @override
  Future<void> restore() async {}
  @override
  Future<MobileAccount> account() async => MobileAccount(
    id: id(90),
    displayName: 'Local UI fixture',
    locale: thai ? 'th' : 'en',
  );
  @override
  Future<MobileMenu> menu(
    String branchId, {
    String? cursor,
    String? menuVersion,
  }) async {
    final product = options_fixture.product().toJson();
    product['name'] = 'เมนู1';
    product['nameEn'] = 'Searchable food 1';
    return MobileMenu(
      branch: branch,
      asOf: '2026-10-23T00:00:00Z',
      priceValidUntil: '2099-01-01T00:00:00Z',
      menuVersion: 'surface-ui',
      priceVersion: id(3),
      pricingRevision: '1',
      nextCursor: null,
      products: [MobileProduct.fromJson(product)],
    );
  }

  @override
  Future<MobileFoodQuote> quoteFood(MobileFoodQuoteRequest request) async {
    quoteRequests++;
    final quote = (await super.quoteFood(request)).toJson();
    final configured = quote['configured'] as Map<String, dynamic>;
    final line = (configured['lines'] as List).single as Map<String, dynamic>;
    // The exercised Soy choice has zero delta; keep the fixture's canonical USD quote.
    line['selections'] = [
      MobileSelectedOption(
        groupId: options_fixture.id(3),
        groupName: 'นม',
        groupNameEn: 'Milk',
        choiceId: options_fixture.id(5),
        choiceName: 'ถั่ว',
        choiceNameEn: 'Soy',
        qty: 1,
        priceDelta: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
      ).toJson(),
    ];
    return MobileFoodQuote.fromJson(quote);
  }
}

void main() => registerCustomerFoodSurfaceTests();

void registerCustomerFoodSurfaceTests({bool native = false}) {
  final variants = native
      ? [(thai: true, dark: false, width: 390.0, scale: 1.0)]
      : [
          (thai: true, dark: false, width: 390.0, scale: 1.0),
          (thai: false, dark: false, width: 390.0, scale: 1.0),
          (thai: true, dark: true, width: 390.0, scale: 1.0),
          (thai: true, dark: true, width: 320.0, scale: 1.5),
          (thai: false, dark: false, width: 390.0, scale: 1.5),
        ];
  for (final variant in variants) {
    final variantName =
        '${variant.thai ? 'th' : 'en'}-${variant.dark ? 'dark' : 'light'}-${variant.width.toInt()}-${variant.scale}';
    testWidgets('U06 U09 U10 U11 U15 root UI $variantName', (tester) async {
      if (!native) {
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = Size(variant.width, 844);
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        for (final family in ['NotoSansThai', 'Inter']) {
          final loader = FontLoader('packages/mobile_shared/$family')
            ..addFont(
              rootBundle.load(
                'packages/mobile_shared/assets/fonts/$family-Variable.ttf',
              ),
            );
          await loader.load();
        }
        final icons = FontLoader('MaterialIcons')
          ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
        await icons.load();
      }
      FlutterSecureStorage.setMockInitialValues({});
      final api = SurfaceFoodApi(variant.thai);
      final boundary = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: variant.dark ? BitPosTheme.dark() : BitPosTheme.light(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                textScaler: TextScaler.linear(variant.scale),
                padding: native
                    ? MediaQuery.of(context).padding
                    : const EdgeInsets.only(top: 44, bottom: 34),
                viewPadding: native
                    ? MediaQuery.of(context).viewPadding
                    : const EdgeInsets.only(top: 44, bottom: 34),
              ),
              child: child!,
            ),
            home: CustomerSessionPage(api: api, pushNative: PushNative()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.runAsync(
        () => precacheImage(
          const AssetImage('assets/design/bitpos-logo.png'),
          tester.element(find.byType(Scaffold).first),
        ),
      );
      final scroll = find.byKey(const ValueKey('customer-root-content-scroll'));
      Map<String, double> rect(Finder finder) {
        final box = tester.getRect(finder.first);
        return {'x': box.left, 'y': box.top, 'w': box.width, 'h': box.height};
      }

      Future<void> capture(String screen, Map<String, dynamic> geometry) async {
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        if (find.byType(ProductOptionsSheet).evaluate().isEmpty) {
          await tester.pumpAndSettle();
        }
        expect(tester.takeException(), isNull, reason: '$screen $variantName');
        final media = MediaQuery.of(
          tester.element(find.byType(Scaffold).first),
        );
        final record = <String, dynamic>{
          'screen': screen,
          'variant': variantName,
          'viewport': {'w': media.size.width, 'h': media.size.height},
          'dpr': tester.view.devicePixelRatio,
          'insets': {
            'top': media.viewPadding.top,
            'bottom': media.viewPadding.bottom,
          },
          ...geometry,
        };
        debugPrint('BITPOS_CUSTOMER_SURFACE_GEOMETRY ${jsonEncode(record)}');
        if (native) {
          debugPrint('BITPOS_CUSTOMER_SURFACE_CAPTURE $screen-$variantName');
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(seconds: 3)),
          );
        } else {
          const directory = String.fromEnvironment('BITPOS_UI_CAPTURE_DIR');
          if (directory.isNotEmpty) {
            await tester.runAsync(() async {
              final image =
                  await (boundary.currentContext!.findRenderObject()
                          as RenderRepaintBoundary)
                      .toImage(pixelRatio: 1);
              final data = await image.toByteData(
                format: ui.ImageByteFormat.png,
              );
              await File('$directory/$screen-$variantName.png')
                  .writeAsBytes(data!.buffer.asUint8List());
              await File('$directory/$screen-$variantName.json')
                  .writeAsString(jsonEncode(record));
              image.dispose();
            });
          }
        }
      }

      void top() =>
          tester.widget<SingleChildScrollView>(scroll).controller!.jumpTo(0);
      Future<void> tapVisible(Finder target) async {
        await tester.ensureVisible(target.first);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        await tester.tap(target.first);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        if (find.byType(ProductOptionsSheet).evaluate().isEmpty) {
          await tester.pumpAndSettle();
        }
      }

      expect(find.byType(MerchantBranchCard), findsOneWidget);
      await capture('U06', {
        'merchant': rect(find.byType(MerchantBranchCard)),
        'search': rect(find.byKey(const ValueKey('branch-discovery-search'))),
      });
      await tapVisible(
        find.text(variant.thai ? 'ร้านทดสอบ' : 'Fixture branch'),
      );
      top();
      await tester.pumpAndSettle();
      expect(find.byType(FoodProductCard), findsOneWidget);
      await capture('U09', {
        'product': rect(find.byType(FoodProductCard)),
        'headerBack': rect(
          find.byTooltip(variant.thai ? 'ร้านอาหาร' : 'Merchants'),
        ),
      });
      await tapVisible(
        find.text(variant.thai ? 'เลือก / เพิ่ม' : 'Configure / add'),
      );
      expect(find.byType(ProductOptionsSheet), findsOneWidget);
      await capture('U10', {
        'hero': rect(find.byKey(const ValueKey('product-detail-hero'))),
        'action': rect(find.byKey(const ValueKey('product-detail-submit'))),
      });
      expect(
        tester
            .getRect(find.byKey(const ValueKey('product-detail-hero')))
            .height,
        closeTo(238, .01),
      );
      expect(
        tester
            .getRect(find.byKey(const ValueKey('product-detail-submit')))
            .left,
        24,
      );
      await tapVisible(
        find.byTooltip(variant.thai ? 'เพิ่ม ถั่ว' : 'Increase Soy'),
      );
      await tapVisible(find.byKey(const ValueKey('product-detail-submit')));
      await tapVisible(
        find.widgetWithText(
          FilledButton,
          variant.thai ? 'ตรวจตะกร้า · 1' : 'Review cart · 1',
        ),
      );
      expect(api.quoteRequests, 1);
      expect(find.byType(QuotePriceSummary), findsOneWidget);
      expect(find.textContaining('2.70 USD'), findsWidgets);
      final quotedTotal = find
          .descendant(
            of: find.byType(QuotePriceSummary),
            matching: find.textContaining('2.70 USD'),
          )
          .last;
      await tester.ensureVisible(quotedTotal);
      await tester.pumpAndSettle();
      expect(
        tester.getRect(quotedTotal).bottom,
        lessThanOrEqualTo(tester.getRect(scroll).bottom),
      );
      expect(
        tester.getRect(quotedTotal).right,
        closeTo(variant.width - 24, .01),
      );
      top();
      await tester.pumpAndSettle();
      await capture('U11', {
        'line': rect(
          find.descendant(
            of: find.byType(ConfiguredFoodLines),
            matching: find.byType(Card),
          ),
        ),
        'summary': rect(find.byType(QuotePriceSummary)),
        'action': rect(
          find.byKey(const ValueKey('customer-cart-review-bottom-action')),
        ),
      });
      if (variant.scale == 1) {
        final firstLine = find.descendant(
          of: find.byType(ConfiguredFoodLines),
          matching: find.byType(Card),
        ).first;
        expect(tester.getRect(firstLine).top, closeTo(137, .01));
        final backSurface = find.byKey(
          const ValueKey('customer-food-back-surface'),
        );
        expect(tester.getRect(backSurface), const Rect.fromLTWH(18, 52, 44, 44));
        expect(
          tester
              .getRect(
                find.byKey(
                  const ValueKey('customer-cart-review-bottom-action'),
                ),
              )
              .top,
          closeTo(686, .01),
        );
      }
      await tapVisible(
        find.byKey(const ValueKey('customer-cart-review-bottom-action')),
      );
      expect(find.byType(QuoteConfirmation), findsOneWidget);
      expect(find.textContaining('Solana devnet'), findsOneWidget);
      top();
      await tester.pumpAndSettle();
      await capture('U15', {
        'line': rect(
          find.descendant(
            of: find.byType(ConfiguredFoodLines),
            matching: find.byType(Card),
          ),
        ),
        'summary': rect(find.byType(QuotePriceSummary)),
        'confirmation': rect(find.byType(QuoteConfirmation)),
      });
      final confirm = find.descendant(
        of: find.byType(QuoteConfirmation),
        matching: find.byType(FilledButton),
      );
      if (variant.scale == 1) {
        expect(tester.getRect(confirm).top, closeTo(730, .01));
      }
      // Back restores the same server quote; it must not submit or replace it.
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(QuoteConfirmation), findsNothing);
      expect(find.byType(QuotePriceSummary), findsOneWidget);
      expect(api.quoteRequests, 1);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(FoodProductCard), findsOneWidget);
      expect(find.textContaining('1 ×'), findsWidgets);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(MerchantBranchCard), findsOneWidget);
      expect(find.byType(FoodProductCard), findsNothing);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    });
  }
}
