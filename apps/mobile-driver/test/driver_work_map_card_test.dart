import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_driver/presentation/driver_work_map_card.dart';

void main() {
  testWidgets(
    'R06 truthful unavailable map fits narrow Thai150percent and uses actual status',
    (tester) async {
      tester.view.physicalSize = const Size(320, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!,
          ),
          home: const Scaffold(
            body: Padding(
              padding: EdgeInsets.all(24),
              child: DriverWorkMapCard(
                thai: true,
                offerCount: 3,
                sharing: false,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('3 งานเสนอจากระบบ'), findsOneWidget);
      expect(find.text('ไม่ได้จับพิกัด'), findsOneWidget);
      expect(find.text('แผนที่ยังไม่พร้อมใช้งาน'), findsOneWidget);
      expect(
        tester.getSize(find.byType(DriverWorkMapCard)).height,
        greaterThanOrEqualTo(262),
      );
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'active private capture is shown without fake coordinates or ratings',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: DriverWorkMapCard(thai: false, offerCount: 0, sharing: true),
          ),
        ),
      );
      expect(find.text('Capturing private location'), findsOneWidget);
      expect(find.text('0 server offers'), findsOneWidget);
      expect(find.text('Not capturing location'), findsNothing);
      expect(find.text('4.9'), findsNothing);
    },
  );
  testWidgets('failed native stop never claims location capture is stopped', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: DriverWorkMapCard(
            thai: false,
            offerCount: 0,
            sharing: false,
            stopUnconfirmed: true,
          ),
        ),
      ),
    );
    expect(find.text('Location stop unconfirmed'), findsOneWidget);
    expect(find.text('Not capturing location'), findsNothing);
  });
}
