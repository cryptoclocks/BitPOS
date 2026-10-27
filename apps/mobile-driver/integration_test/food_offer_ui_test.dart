import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/presentation/driver_food_offer_card.dart';
import 'package:bitpos_driver/presentation/driver_presentation.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('R07 presentation on native Android, local UI fixture only', (
    tester,
  ) async {
    var accepted = false;
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: DriverPresentation(
          child: Scaffold(
            appBar: AppBar(title: const Text('งานใหม่ใกล้คุณ')),
            body: SingleChildScrollView(
              child: Column(
                children: [
                  const Padding(
                    padding: EdgeInsets.all(12),
                    child: Text(
                      'LOCAL UI FIXTURE · ไม่มี API / GPS / รายได้จริง',
                    ),
                  ),
                  DriverFoodOfferCard(
                    thai: true,
                    deadline: DateTime.now().add(const Duration(seconds: 10)),
                    expiryLabel: 'งานตัวอย่าง · หมดอายุ 12:00',
                    earning: '0.550000 USDG',
                    pickup: '13.745, 100.535 · พิกัดตัวอย่าง',
                    onAccept: () => accepted = true,
                    declineAction: TextButton(
                      onPressed: () {},
                      child: const Text('ปฏิเสธงานพร้อมเหตุผล'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    debugPrint('BITPOS_R07_UI_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    final accept = find.text('รับงานนี้');
    await tester.scrollUntilVisible(accept, 200);
    await tester.tap(accept);
    expect(accepted, isTrue);
    expect(find.text('ยังไม่ใช่รายได้ที่ชำระแล้ว'), findsOneWidget);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 11)),
    );
    await tester.pumpAndSettle();
    expect(find.text('ข้อเสนองานหมดอายุแล้ว'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    debugPrint('BITPOS_R07_NATIVE_DEADLINE_EXPIRED');
    expect(tester.takeException(), isNull);
  });
}
