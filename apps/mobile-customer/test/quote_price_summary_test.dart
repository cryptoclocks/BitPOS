import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/quote_price_summary.dart';

void main() {
  for (final thai in [true, false]) {
    testWidgets(
      'compact summary retains every supplied nonzero charge thai=$thai',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(320, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
              child: Scaffold(
                body: SingleChildScrollView(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: QuotePriceSummary(
                      thai: thai,
                      compact: true,
                      subtotal: 'USD 12.00',
                      discount: 'USD 1.00',
                      fees: 'USD 2.00',
                      tax: 'USD 0.50',
                      total: 'USD 13.50',
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        for (final value in [
          'USD 12.00',
          'USD 1.00',
          'USD 2.00',
          'USD 0.50',
          'USD 13.50',
        ]) {
          expect(find.text(value), findsOneWidget);
        }
        expect(find.text(thai ? 'ส่วนลด' : 'Discount'), findsOneWidget);
        expect(
          find.text(thai ? 'ภาษีเพิ่มเติม' : 'Additional tax'),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets('Thai narrow summary preserves canonical total at large text', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
          child: const Scaffold(
            body: SingleChildScrollView(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: QuotePriceSummary(
                  thai: true,
                  subtotal: 'USD 12.00',
                  discount: 'USD 1.00',
                  fees: 'USD 2.00',
                  tax: 'USD 0.50',
                  total: 'USD 13.50',
                ),
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.text('USD 13.50'), findsOneWidget);
    expect(find.text('ค่าธรรมเนียมรวม'), findsOneWidget);
    expect(
      tester.getRect(find.text('USD 13.50')).right,
      closeTo(tester.getRect(find.text('USD 12.00')).right, 0.1),
    );
    expect(tester.takeException(), isNull);
  });
}
