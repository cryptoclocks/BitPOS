import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/presentation/feature_ui.dart';

void main() {
  testWidgets('group name field and member spacing follow native flow', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final name = TextEditingController(text: 'Our meal');
    addTearDown(name.dispose);
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: GroupOrderPage(
          title: 'Group',
          nameController: name,
          members: const [(name: 'Owner', summary: 'Two items')],
          thai: false,
        ),
      ),
    );
    final field = tester.getRect(
      find.byKey(const ValueKey('group-name-input')),
    );
    final member = tester.getRect(find.byType(FeatureTile).first);
    expect(field.left, 24);
    expect(field.width, 342);
    expect(field.height, greaterThanOrEqualTo(52));
    expect(member.top - field.bottom, closeTo(38, 0.1));
    await tester.enterText(find.byType(TextField), 'New shared meal');
    expect(name.text, 'New shared meal');
    expect(tester.takeException(), isNull);
  });
  testWidgets('multi merchant card rhythm follows 82 plus 18 native spacing', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    String? opened;
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: MultiMerchantPage(
          title: 'Merchants',
          orders: const [
            UiMerchantOrder(id: 'one', name: 'First', summary: 'Two items'),
            UiMerchantOrder(id: 'two', name: 'Second', summary: 'One item'),
          ],
          onOpen: (id) => opened = id,
          thai: false,
        ),
      ),
    );
    final cards = find.byType(FeatureTile);
    expect(
      tester.getRect(cards.at(1)).top - tester.getRect(cards.first).top,
      closeTo(100, 0.1),
    );
    await tester.tap(find.text('Second'));
    expect(opened, 'two');
    expect(tester.takeException(), isNull);
  });
}
