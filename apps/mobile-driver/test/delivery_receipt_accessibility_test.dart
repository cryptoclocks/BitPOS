import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/food_work_page.dart';
import 'package:bitpos_driver/earnings_page.dart';
import 'delivery_receipt_test.dart' show ReceiptApi;
import 'food_realtime_lifecycle_test.dart' show ActiveNative;

void main() {
  testWidgets('Thai dark 320px 150-percent text keeps completion actions reachable', (tester) async {
    final previous = GeolocatorPlatform.instance;
    final native = ActiveNative();
    GeolocatorPlatform.instance = native;
    final api = ReceiptApi(true);
    await tester.binding.setSurfaceSize(const Size(320, 844));
    addTearDown(() async {
      api.close();
      native.close();
      GeolocatorPlatform.instance = previous;
      await tester.binding.setSurfaceSize(null);
    });
    await tester.pumpWidget(MaterialApp(
      theme: BitPosTheme.dark(),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(1.5)),
        child: child!,
      ),
      home: FoodWorkPage(api: api, thai: true),
    ));
    await tester.pumpAndSettle();
    final proof = find.byKey(const ValueKey('food-custody-DELIVERY'));
    await tester.scrollUntilVisible(proof, 250);
    await tester.ensureVisible(proof);
    await tester.pumpAndSettle();
    await tester.tap(proof);
    await tester.pump(const Duration(milliseconds: 350));
    await tester.enterText(find.byType(TextField), 'a' * 43);
    await tester.ensureVisible(find.widgetWithText(FilledButton, 'ยืนยัน'));
    await tester.pump(const Duration(milliseconds: 350));
    await tester.tap(find.widgetWithText(FilledButton, 'ยืนยัน'));
    await tester.pumpAndSettle();
    expect(find.text('งานนี้ส่งสำเร็จแล้ว'), findsOneWidget);
    expect(tester.takeException(), isNull);
    final earnings = find.byKey(const ValueKey('food-delivery-view-earnings'));
    await tester.ensureVisible(earnings);
    await tester.pumpAndSettle();
    await tester.tap(earnings);
    await tester.pumpAndSettle();
    expect(find.byType(DriverEarningsPage), findsOneWidget);
    expect(tester.takeException(), isNull);
    Navigator.of(tester.element(find.byType(DriverEarningsPage))).pop();
    await tester.pumpAndSettle();
    final next = find.byKey(const ValueKey('food-delivery-next-job'));
    await tester.ensureVisible(next);
    await tester.pumpAndSettle();
    await tester.tap(next);
    await tester.pumpAndSettle();
    expect(find.text('พร้อมรับงานวันนี้'), findsOneWidget);
    expect(find.byKey(const ValueKey('food-delivery-confirmed')), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
