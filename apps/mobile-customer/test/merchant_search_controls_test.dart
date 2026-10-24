import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/merchant_search_controls.dart';

void main() {
  testWidgets(
    'clear edits only draft; explicit submit and service choose are separate',
    (tester) async {
      final controller = TextEditingController(text: 'Coffee');
      addTearDown(controller.dispose);
      var searches = 0;
      String? serving;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MerchantSearchControls(
              controller: controller,
              thai: false,
              busy: false,
              serving: 'all',
              onSearch: () => searches++,
              onServing: (value) => serving = value,
            ),
          ),
        ),
      );
      await tester.tap(find.byTooltip('Clear search text'));
      await tester.pump();
      expect(controller.text, isEmpty);
      expect(searches, 0);
      await tester.tap(find.text('Search merchants'));
      expect(searches, 1);
      await tester.tap(find.text('Delivery'));
      expect(serving, 'delivery');
    },
  );
  testWidgets(
    'busy locks controls and Thai150percent narrow input has no overflow',
    (tester) async {
      tester.view.physicalSize = const Size(320, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = TextEditingController(text: 'กาแฟ');
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!,
          ),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: MerchantSearchControls(
                controller: controller,
                thai: true,
                busy: true,
                serving: 'delivery',
                onSearch: () => fail('Busy search'),
                onServing: (_) => fail('Busy filter'),
              ),
            ),
          ),
        ),
      );
      expect(tester.widget<TextField>(find.byType(TextField)).enabled, isFalse);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      for (final chip in tester.widgetList<ChoiceChip>(
        find.byType(ChoiceChip),
      )) {
        expect(chip.onSelected, isNull);
      }
      expect(tester.takeException(), isNull);
    },
  );
}
