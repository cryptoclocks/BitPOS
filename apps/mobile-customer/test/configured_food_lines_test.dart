import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/configured_food_lines.dart';

void main() {
  testWidgets('narrow large Thai text retains snapshot name, money and full note', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final price = MobileMoney(currency: 'USD', decimals: 2, amountMinor: '270');
    final line = MobileConfiguredFoodLine(
      lineId: '10000000-0000-4000-8000-000000000001',
      productId: '10000000-0000-4000-8000-000000000002',
      priceVersion: '10000000-0000-4000-8000-000000000003',
      name: 'อาหารสำหรับทดสอบชื่อยาว', nameEn: '', qty: 1,
      optionVersion: null, selections: [], allergyNote: 'แพ้ถั่ว กรุณาแยกภาชนะในการปรุงอาหาร',
      productBasePrice: price, productUnitPrice: price, optionsUnitPrice: price,
      basePrice: price, unitPrice: price, lineTotal: price,
    );
    await tester.pumpWidget(MaterialApp(home: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
      child: Scaffold(body: SingleChildScrollView(child: Padding(
        padding: const EdgeInsets.all(24), child: ConfiguredFoodLines(lines: [line], thai: false)))),
    )));
    expect(find.text('1 × อาหารสำหรับทดสอบชื่อยาว'), findsOneWidget);
    expect(find.textContaining('แพ้ถั่ว กรุณาแยกภาชนะในการปรุงอาหาร'), findsOneWidget);
    expect(find.text('2.70 USD'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
