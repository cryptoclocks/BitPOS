import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/presentation/bitpos_state_view.dart';

void main() {
  const en = {
    BitPosStateKind.loading: 'Loading',
    BitPosStateKind.empty: 'Nothing here yet',
    BitPosStateKind.error: 'Something went wrong',
    BitPosStateKind.offline: 'You are offline',
    BitPosStateKind.closed: 'Currently closed',
    BitPosStateKind.outOfZone: 'Outside the delivery area',
  };
  const th = {
    BitPosStateKind.loading: 'กำลังโหลด',
    BitPosStateKind.empty: 'ยังไม่มีรายการ',
    BitPosStateKind.error: 'เกิดข้อผิดพลาด',
    BitPosStateKind.offline: 'ไม่มีการเชื่อมต่อ',
    BitPosStateKind.closed: 'ร้านปิดอยู่',
    BitPosStateKind.outOfZone: 'อยู่นอกพื้นที่จัดส่ง',
  };
  for (final thai in [false, true]) {
    for (final dark in [false, true]) {
      for (final scale in [1.0, 2.0]) {
        testWidgets('all kinds thai=$thai dark=$dark scale=$scale', (
          tester,
        ) async {
          tester.view.devicePixelRatio = 1;
          tester.view.physicalSize = const Size(320, 900);
          addTearDown(tester.view.reset);
          var taps = 0;
          for (final kind in BitPosStateKind.values) {
            await tester.pumpWidget(
              MaterialApp(
                theme: dark ? ThemeData.dark() : ThemeData.light(),
                home: MediaQuery(
                  data: MediaQueryData(textScaler: TextScaler.linear(scale)),
                  child: Scaffold(
                    body: SingleChildScrollView(
                      child: BitPosStateView(
                        kind: kind,
                        thai: thai,
                        actionLabel: thai ? 'ลองใหม่' : 'Retry',
                        onAction: () => taps++,
                      ),
                    ),
                  ),
                ),
              ),
            );
            expect(tester.takeException(), isNull);
            expect(
              find.text((thai ? th : en)[kind]!),
              findsOneWidget,
              reason: kind.name,
            );
            expect(
              find.byType(CircularProgressIndicator),
              kind == BitPosStateKind.loading ? findsOneWidget : findsNothing,
            );
            await tester.tap(find.byType(OutlinedButton));
          }
          expect(taps, BitPosStateKind.values.length);
        });
      }
    }
  }

  testWidgets('caller message overrides default and no action hides button', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: const Scaffold(
          body: BitPosStateView(
            kind: BitPosStateKind.error,
            thai: false,
            message: 'Server said no',
          ),
        ),
      ),
    );
    expect(find.text('Server said no'), findsOneWidget);
    expect(find.byType(OutlinedButton), findsNothing);
  });
}
