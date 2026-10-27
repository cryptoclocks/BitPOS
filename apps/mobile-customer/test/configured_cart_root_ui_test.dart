import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'customer_onboarding_ui_test.dart' show loadFonts;

import 'package:flutter/material.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/presentation/food_cart_line_card.dart';

import 'food_cart_refresh_test.dart' show CartRefreshApi;

class RefusedCartApi extends CartRefreshApi {
  RefusedCartApi(this.code);
  final String code;
  @override
  Future<MobileFoodQuote> quoteFood(MobileFoodQuoteRequest request) async {
    quotes.add(request);
    throw MobileApiException(code, 409);
  }
}

void main() {
  for (final code in [
    'STOCK_UNAVAILABLE',
    'PRICE_VERSION_CHANGED',
    'SERVING_UNAVAILABLE',
  ]) {
    testWidgets('$code preserves configured draft and exposes recovery', (
      tester,
    ) async {
      await loadFonts(tester);
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.reset);
      final boundary = GlobalKey();
      final api = RefusedCartApi(code);
      addTearDown(api.close);
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: BitPosTheme.light(),
            home: Scaffold(
              body: SingleChildScrollView(
                child: FoodPage(
                  api: api,
                  thai: false,
                  onAuthenticationRequired: () => fail('auth'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      Future<void> tap(Finder target) async {
        await tester.ensureVisible(target);
        await tester.tap(target);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
      }

      await tap(find.text('Fixture branch'));
      await tester.pumpAndSettle();
      await tap(find.text('Configure / add'));
      await tap(find.byTooltip('Increase Oat'));
      await tester.enterText(find.byType(TextField).last, 'Keep this note');
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      final submit = find.byKey(const ValueKey('product-detail-submit'));
      expect(tester.getRect(submit).bottom, lessThanOrEqualTo(544));

      await tap(find.text('Add to cart'));
      tester.view.viewInsets = const FakeViewPadding();
      await tester.pumpAndSettle();
      final before = tester
          .widget<FoodCartLineCard>(find.byType(FoodCartLineCard))
          .item;
      await tap(find.text('Review cart · 1'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('food-action-error')), findsOneWidget);
      expect(
        find.text(
          code == 'STOCK_UNAVAILABLE'
              ? 'Stock changed. Review your cart.'
              : code == 'SERVING_UNAVAILABLE'
              ? 'This service is unavailable. Choose another merchant.'
              : 'Quote expired or changed. Request a fresh quote.',
        ),
        findsOneWidget,
      );
      expect(find.text('Refresh menu; keep cart'), findsOneWidget);
      await tester.ensureVisible(
        find.byKey(const ValueKey('food-action-error')),
      );
      await tester.pumpAndSettle();
      final out = Platform.environment['BITPOS_DS05_CAPTURE_DIR'];
      if (out != null) {
        final render =
            boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await render.toImage(pixelRatio: 1);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File('$out/cart-$code.png');
          await file.create(exclusive: true);
          await file.writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }

      final after = tester
          .widget<FoodCartLineCard>(find.byType(FoodCartLineCard))
          .item;
      expect(after.lineId, before.lineId);
      expect(
        after.selections.single.choiceId,
        before.selections.single.choiceId,
      );
      expect(after.allergyNote, 'Keep this note');
      await tap(find.text('Refresh menu; keep cart'));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('food-action-error')), findsNothing);
      expect(
        tester
            .widget<FoodCartLineCard>(find.byType(FoodCartLineCard))
            .item
            .lineId,
        before.lineId,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets(
    'same product distinct options keep line identity through edit remove and quote request',
    (tester) async {
      final api = CartRefreshApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () => fail('auth'),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Fixture branch'));
      await tester.pumpAndSettle();
      Future<void> tap(Finder target) async {
        await tester.ensureVisible(target);
        await tester.tap(target);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
      }

      for (final selection in [
        ('Oat', 'First configured line'),
        ('Soy', 'Second configured line'),
      ]) {
        await tap(find.text('Configure / add'));
        await tap(find.byTooltip('Increase ${selection.$1}'));
        await tester.enterText(find.byType(TextField).last, selection.$2);
        await tap(find.text('Add to cart'));
        await tester.pumpAndSettle();
      }
      final cards = tester
          .widgetList<FoodCartLineCard>(find.byType(FoodCartLineCard))
          .toList();
      expect(cards.length, 2);
      expect(cards[0].item.productId, cards[1].item.productId);
      expect(cards[0].item.lineId, isNot(cards[1].item.lineId));
      final first = cards[0].item, second = cards[1].item;
      expect(
        first.selections.single.choiceId,
        isNot(second.selections.single.choiceId),
      );
      Finder line(String id) => find.byWidgetPredicate(
        (widget) => widget is FoodCartLineCard && widget.item.lineId == id,
      );
      await tap(
        find.descendant(
          of: line(second.lineId),
          matching: find.text('Edit item'),
        ),
      );
      await tap(find.byTooltip('Increase Oat'));
      await tap(find.text('Save item'));
      await tester.pumpAndSettle();
      final edited = tester.widget<FoodCartLineCard>(line(second.lineId)).item;
      expect(edited.lineId, second.lineId);
      expect(edited.allergyNote, 'Second configured line');
      expect(
        edited.selections.single.choiceId,
        first.selections.single.choiceId,
      );
      expect(
        tester.widget<FoodCartLineCard>(line(first.lineId)).item.allergyNote,
        'First configured line',
      );
      await tap(find.text('Review cart · 2'));
      await tester.pumpAndSettle();
      final request = api.quotes.last;
      expect(request.items.length, 2);
      expect(request.items.map((item) => item.lineId).toSet(), {
        first.lineId,
        second.lineId,
      });
      await tap(
        find.descendant(
          of: line(first.lineId),
          matching: find.text('Remove item'),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(FoodCartLineCard), findsOneWidget);
      expect(
        tester
            .widget<FoodCartLineCard>(find.byType(FoodCartLineCard))
            .item
            .lineId,
        second.lineId,
      );
      await tap(find.text('Review cart · 1'));
      await tester.pumpAndSettle();
      expect(api.quotes.last.items.single.lineId, second.lineId);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
