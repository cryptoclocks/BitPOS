import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/presentation/food_product_card.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/product_options_sheet.dart';

import 'food_menu_pages_test.dart' show MenuPagesApi;

const id = '00000000-0000-4000-8000-000000000041';
MobileProduct product({int available = 2, bool priced = true}) => MobileProduct(
  id: id,
  name: 'กาแฟทดสอบชื่อยาว',
  nameEn: '',
  category: 'กาแฟ',
  description: 'รายละเอียดสินค้าและตัวเลือกจากร้าน',
  imageUrl: '',
  available: available,
  unitPrice: priced
      ? MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270')
      : null,
  basePrice: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270'),
  options: MobileProductOptions(
    version: null,
    revision: '0',
    noteEnabled: true,
    groups: [],
  ),
);
void main() {
  testWidgets(
    'FoodPage configure button opens canonical option sheet without adding immediately',
    (tester) async {
      final api = MenuPagesApi()..failContinuation = false;
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: FoodPage(
                api: api,
                thai: false,
                onAuthenticationRequired: () {},
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Fixture branch'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'food 500');
      await tester.pumpAndSettle();
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Configure / add'));
      await tester.tap(find.text('Configure / add'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds:500));
      expect(find.byType(ProductOptionsSheet), findsOneWidget);
      expect(find.text('Searchable food 500'), findsWidgets);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey('product-detail-back')));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const MaterialApp());
    },
  );

  testWidgets(
    'Thai large narrow card retains real price and configure action',
    (tester) async {
      tester.view.physicalSize = const Size(320, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var configured = 0;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!,
          ),
          home: Scaffold(
            body: SingleChildScrollView(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: FoodProductCard(
                  product: product(),
                  thai: true,
                  onConfigure: () => configured++,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('เลือก / เพิ่ม'));
      expect(configured, 1);
      expect(find.textContaining('2.70'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'sold out and absent pricing remain disabled and do not invent totals',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FoodProductCard(
              product: product(available: 0, priced: false),
              thai: false,
            ),
          ),
        ),
      );
      expect(find.text('Sold out'), findsOneWidget);
      expect(find.text('Pricing unavailable'), findsOneWidget);
      expect(find.text('กาแฟทดสอบชื่อยาว'), findsOneWidget);
      expect(
        tester.widget<OutlinedButton>(find.byType(OutlinedButton)).onPressed,
        isNull,
      );
    },
  );
}
