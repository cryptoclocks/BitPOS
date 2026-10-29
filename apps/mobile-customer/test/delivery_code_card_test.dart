import 'package:bitpos_customer/food_delivery_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

// E2E 2026-10-30 P0-3: the 43-character handover secret must be readable (large, grouped) and copyable.
const secret = 'abcdEFGHijklMNOPqrstUVWXyz0123456789_-ABCDe';
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('grouped splits into blocks of four without altering characters', () {
    final g = DeliveryCodeCard.grouped(secret);
    expect(g.replaceAll(' ', ''), secret);
    expect(g.split(' ').every((b) => b.length <= 4), isTrue);
    expect(g.split(' ').length, 11);
  });
  testWidgets('shows the grouped code and copies the exact original secret', (tester) async {
    String? copied;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
      if (call.method == 'Clipboard.setData') {
        copied = (call.arguments as Map)['text'] as String;
      }
      return null;
    });
    addTearDown(
      () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(SystemChannels.platform, null),
    );
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: DeliveryCodeCard(secret: secret, thai: true)),
      ),
    );
    expect(find.text(DeliveryCodeCard.grouped(secret)), findsOneWidget);
    expect(find.text('รหัสส่งมอบอาหาร'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('delivery-code-copy')));
    await tester.pump();
    expect(copied, secret);
    expect(find.text('คัดลอกรหัสแล้ว'), findsOneWidget);
  });
}
