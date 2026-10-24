// Local UI fixtures only; no provider, GPS, payment or backend operations.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:bitpos_driver/food_history_page.dart';
import 'package:bitpos_driver/presentation/driver_history_card.dart';
import 'package:bitpos_driver/presentation/driver_navigation.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import '../test/food_history_page_test.dart' as fixture;
import '../test/driver_earnings_surface_test.dart' show second;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  for (final thai in [false, true]) {
    testWidgets('R15 native page-local filter preserves pagination and quoted fee; thai=$thai', (tester) async {
      final api = fixture.HistoryApi()..newestState = 'RETURNED';
      addTearDown(api.close);
      await tester.pumpWidget(MaterialApp(theme: BitPosTheme.light(), home: DriverDestination(thai: thai, index: 1, child: DriverFoodHistoryPage(api: api, thai: thai))));
      await tester.pumpAndSettle();
      expect(find.byType(DriverHistoryCard), findsOneWidget);
      await tester.tap(find.text(thai ? 'สำเร็จ' : 'Delivered'));
      await tester.pumpAndSettle();
      expect(find.byType(DriverHistoryCard), findsNothing);
      final older = find.text(thai ? 'งานเก่ากว่านี้' : 'Older deliveries');
      await tester.ensureVisible(older);
      await tester.tap(older);
      await tester.pumpAndSettle();
      expect(api.cursors, [null, second]);
      expect(find.byType(DriverHistoryCard), findsNothing);
      await tester.tap(find.text(thai ? 'ทั้งหมด' : 'All'));
      await tester.pumpAndSettle();
      expect(find.byType(DriverHistoryCard), findsOneWidget);
      expect(find.text('2.70 USD'), findsOneWidget);
      expect(find.descendant(of: find.byType(DriverHistoryCard), matching: find.text(thai ? 'ค่าจัดส่งตามราคาเดิม' : 'Quoted delivery fee')), findsOneWidget);
      expect(find.textContaining(thai ? 'ปล่อยงานแล้ว' : 'Assignment released'), findsOneWidget);
      expect(api.compensationAssignments, isEmpty);
      expect(tester.takeException(), isNull);
      debugPrint('R15_NATIVE_FILTER_PAGINATION_PASS thai=$thai');
    });
  }
}
