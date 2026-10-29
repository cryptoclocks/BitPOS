import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/presentation/food_cart_line_card.dart';

import 'product_options_test.dart' as fixture;

void main() {
  final item = MobileConfiguredCartItem(
    lineId: fixture.id(6),
    productId: fixture.id(1),
    qty: 2,
    optionVersion: fixture.id(2),
    selections: [
      MobileOptionSelection(
        groupId: fixture.id(3),
        choiceId: fixture.id(99),
        qty: 1,
      ),
    ],
    allergyNote: 'No dairy',
  );
  testWidgets(
    'missing choice with unchanged version renders recoverable state, note and independent actions',
    (tester) async {
      var edits = 0, removed = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: FoodCartLineCard(
              item: item,
              product: fixture.product(),
              thai: false,
              onEdit: () => edits++,
              onRemove: () => removed++,
            ),
          ),
        ),
      );
      expect(find.text('Options changed. Review this item.'), findsOneWidget);
      expect(find.text('No dairy'), findsOneWidget);
      await tester.tap(find.text('Edit item'));
      expect(edits, 1);
      expect(removed, 0);
      await tester.tap(find.text('Remove item'));
      expect(removed, 1);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'removed product retains note and remove action at Thai150percent narrow width',
    (tester) async {
      tester.view.physicalSize = const Size(320, 1000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var removed = 0;
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
              child: FoodCartLineCard(
                item: item,
                product: null,
                thai: true,
                onRemove: () => removed++,
              ),
            ),
          ),
        ),
      );
      expect(find.text('No dairy'), findsOneWidget);
      expect(find.text('แก้ไขรายการ'), findsNothing);
      await tester.tap(find.text('ลบรายการ'));
      expect(removed, 1);
      expect(tester.takeException(), isNull);
    },
  );
  for (final width in [320.0, 390.0]) {
    for (final thai in [true, false]) {
      testWidgets(
        'long configured content remains readable and actionable at $width thai=$thai',
        (tester) async {
          tester.view.physicalSize = Size(width, 1200);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          const thTitle = 'กาแฟนมโอ๊ตสูตรพิเศษสำหรับผู้แพ้นมวัว';
          const enTitle = 'Special iced oat milk coffee with custom preparation';
          const thGroup = 'ตัวเลือกนมและวิธีเตรียมเครื่องดื่ม';
          const enGroup = 'Milk selection and drink preparation';
          const thChoice = 'นมโอ๊ตไม่หวานแยกน้ำแข็ง';
          const enChoice = 'Unsweetened oat milk with ice served separately';
          final note = thai
              ? 'แพ้นมวัวและถั่ว กรุณาแยกอุปกรณ์เตรียมเครื่องดื่มอย่างระมัดระวัง'
              : 'Dairy and nut allergy: please use separate preparation equipment carefully.';
          final base = fixture.product();
          final configured = MobileProduct(
            id: base.id,
            name: thTitle,
            nameEn: enTitle,
            category: base.category,
            description: base.description,
            imageUrl: '',
            available: base.available,
            unitPrice: base.unitPrice,
            basePrice: base.basePrice,
            options: MobileProductOptions(
              version: fixture.id(2),
              revision: '1',
              noteEnabled: true,
              groups: [
                MobileOptionGroup(
                  id: fixture.id(3),
                  name: thGroup,
                  nameEn: enGroup,
                  enabled: true,
                  minSelections: 1,
                  maxSelections: 1,
                  choices: [
                    MobileOptionChoice(
                      id: fixture.id(4),
                      name: thChoice,
                      nameEn: enChoice,
                      enabled: true,
                      maxQty: 1,
                      priceDelta: MobileMoney(
                        currency: 'USD',
                        decimals: 2,
                        amountMinor: '0',
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
          var edits = 0, removals = 0;
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData.dark(),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: const TextScaler.linear(1.5),
                ),
                child: child!,
              ),
              home: Scaffold(
                body: SingleChildScrollView(
                  padding: const EdgeInsets.all(24),
                  child: FoodCartLineCard(
                    item: MobileConfiguredCartItem(
                      lineId: item.lineId,
                      productId: item.productId,
                      qty: 2,
                      optionVersion: fixture.id(2),
                      selections: [
                        MobileOptionSelection(
                          groupId: fixture.id(3),
                          choiceId: fixture.id(4),
                          qty: 1,
                        ),
                      ],
                      allergyNote: note,
                    ),
                    product: configured,
                    thai: thai,
                    onEdit: () => edits++,
                    onRemove: () => removals++,
                  ),
                ),
              ),
            ),
          );
          expect(find.text('2 × ${thai ? thTitle : enTitle}'), findsOneWidget);
          expect(
            find.text('${thai ? thGroup : enGroup}: ${thai ? thChoice : enChoice} × 1'),
            findsOneWidget,
          );
          await tester.ensureVisible(find.text(note));
          expect(find.text(note).hitTestable(), findsOneWidget);
          final edit = find.text(thai ? 'แก้ไขรายการ' : 'Edit item');
          final remove = find.text(thai ? 'ลบรายการ' : 'Remove item');
          await tester.ensureVisible(edit);
          await tester.tap(edit);
          await tester.ensureVisible(remove);
          await tester.tap(remove);
          expect(edits, 1);
          expect(removals, 1);
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
}
