import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/quote_price_summary.dart';

void main() {
  testWidgets('Thai narrow summary preserves canonical total at large text', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(home: MediaQuery(
      data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
      child: const Scaffold(body: SingleChildScrollView(child: Padding(
        padding: EdgeInsets.all(24), child: QuotePriceSummary(thai: true,
          subtotal: 'USD 12.00', discount: 'USD 1.00', fees: 'USD 2.00',
          tax: 'USD 0.50', total: 'USD 13.50')))),
    )));
    expect(find.text('USD 13.50'), findsOneWidget);
    expect(find.text('ค่าธรรมเนียมรวม'), findsOneWidget);
    expect(tester.getRect(find.text('USD 13.50')).right, closeTo(tester.getRect(find.text('USD 12.00')).right, 0.1));
    expect(tester.takeException(), isNull);
  });
}
