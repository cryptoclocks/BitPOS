import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/presentation/bitpos_info.dart';

void main() {
  for (final thai in [true, false]) {
    testWidgets('info line keeps summary short and opens full details (${thai ? 'th' : 'en'})', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: BitPosInfoLine(
              thai: thai,
              summary: 'short',
              title: thai ? 'หัวข้อ' : 'Title',
              paragraphs: const ['long one', 'long two'],
            ),
          ),
        ),
      );
      expect(find.text('long one'), findsNothing);
      final size = tester.getSize(find.byType(IconButton));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
      expect(
        find.byTooltip(thai ? 'รายละเอียด: หัวข้อ' : 'Details: Title'),
        findsOneWidget,
      );
      await tester.tap(find.byType(IconButton));
      await tester.pumpAndSettle();
      expect(find.text('long one'), findsOneWidget);
      expect(find.text('long two'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('bitpos-info-close')));
      await tester.pumpAndSettle();
      expect(find.text('long one'), findsNothing);
    });
  }
}
