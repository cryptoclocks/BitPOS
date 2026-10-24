import 'package:bitpos_customer/food_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_menu_pages_test.dart' show MenuPagesApi;

class CartReviewApi extends MenuPagesApi {
  @override
  Future<MobileFoodQuote> quoteFood(MobileFoodQuoteRequest request) async {
    final item = request.items.single;
    final unit = MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270');
    final totalMinor = (270 * item.qty).toString();
    final total = MobileMoney(
      currency: 'USD',
      decimals: 2,
      amountMinor: totalMinor,
    );
    final line = MobileConfiguredFoodLine(
      lineId: item.lineId,
      productId: item.productId,
      name: 'เมนู1',
      nameEn: 'Searchable food 1',
      qty: item.qty,
      priceVersion: id(3),
      optionVersion: item.optionVersion,
      selections: const [],
      allergyNote: item.allergyNote,
      productBasePrice: unit,
      productUnitPrice: unit,
      optionsUnitPrice: MobileMoney(
        currency: 'USD',
        decimals: 2,
        amountMinor: '0',
      ),
      basePrice: unit,
      unitPrice: unit,
      lineTotal: total,
    );
    return MobileFoodQuote(
      id: id(20),
      merchantId: id(2),
      branchId: request.branchId,
      priceVersion: id(3),
      pricingRevision: '1',
      quotedAt: DateTime.now().toUtc().toIso8601String(),
      validUntil: DateTime.now()
          .toUtc()
          .add(const Duration(minutes: 2))
          .toIso8601String(),
      lines: [
        MobileFoodLine(
          productId: item.productId,
          name: line.name,
          nameEn: line.nameEn,
          qty: item.qty,
          unitPrice: unit,
          basePrice: unit,
        ),
      ],
      subtotal: total,
      discount: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
      fees: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
      tax: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
      total: total,
      settlement: MobileSettlement(
        money: MobileMoney(
          currency: 'USDG',
          decimals: 6,
          amountMinor: '${27000 * item.qty}',
        ),
        recipient: 'fixture',
        network: 'solana:devnet',
        genesisHash: 'fixture',
        mint: 'fixture',
        tokenProgram: 'fixture',
        testToken: true,
      ),
      configured: MobileConfiguredFoodSnapshot(
        lines: [line],
        subtotal: total,
        discount: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
        fees: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
        tax: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
        total: total,
      ),
      delivery: null,
    );
  }
}

String id(int n) => 'aa000000-0000-4000-8000-${n.toString().padLeft(12, '0')}';

void main() {
  testWidgets(
    'cart summary is a distinct server-quoted step before order confirmation',
    (tester) async {
      final api = CartReviewApi()..failContinuation = false;
      final navigation = FoodPageNavigation();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: StatefulBuilder(
            builder: (context, setState) {
              navigation.onCartReviewChanged = () => setState(() {});
              return Scaffold(
                bottomNavigationBar: navigation.cartReviewActive
                    ? FilledButton(
                        key: const ValueKey(
                          'customer-cart-review-bottom-action',
                        ),
                        onPressed: navigation.canContinueOrderReview
                            ? navigation.continueOrderReview
                            : null,
                        child: const Text('Continue to order review'),
                      )
                    : null,
                body: SingleChildScrollView(
                  child: FoodPage(
                    api: api,
                    thai: false,
                    navigation: navigation,
                    onAuthenticationRequired: () {},
                  ),
                ),
              );
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Fixture branch'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'food 500');
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Configure / add'));
      await tester.tap(find.text('Configure / add'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.ensureVisible(find.text('Add to cart'));
      await tester.tap(find.text('Add to cart'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Review cart · 1'));
      await tester.tap(find.text('Review cart · 1'));
      await tester.pumpAndSettle();

      expect(find.text('Your cart'), findsOneWidget);
      expect(find.text('Price summary'), findsOneWidget);
      expect(find.text('Continue to order review'), findsOneWidget);
      expect(find.text('Test settlement'), findsNothing);

      expect(
        find.byKey(const ValueKey('customer-cart-review-bottom-action')),
        findsOneWidget,
      );
      await tester.tap(
        find.byKey(const ValueKey('customer-cart-review-bottom-action')),
      );
      await tester.pumpAndSettle();
      expect(find.text('Review order'), findsOneWidget);
      expect(find.textContaining('Test settlement:'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
