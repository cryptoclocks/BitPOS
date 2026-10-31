import 'dart:io';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_design_tokens.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/presentation/bitpos_controls.dart';

void main() {
  for (final variant in [
    (thai: true, dark: false, width: 390.0, scale: 1.0),
    (thai: false, dark: false, width: 390.0, scale: 1.0),
    (thai: true, dark: true, width: 320.0, scale: 1.5),
    (thai: false, dark: false, width: 1440.0, scale: 1.5),
  ]) {
    final name =
        '${variant.thai ? 'th' : 'en'}-${variant.dark ? 'dark' : 'light'}-${variant.width.toInt()}-${variant.scale}';
    testWidgets('shared controls render and preserve action boundaries $name', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(variant.width, 1100);
      addTearDown(tester.view.reset);
      await tester.runAsync(() async {
        for (final family in ['NotoSansThai', 'Inter']) {
          await (FontLoader('packages/mobile_shared/$family')..addFont(
                File('assets/fonts/$family-Variable.ttf')
                    .readAsBytes()
                    .then(ByteData.sublistView),
              ))
              .load();
        }
        final config = jsonDecode(
          File('.dart_tool/package_config.json').readAsStringSync(),
        ) as Map<String, dynamic>;
        final flutter = (config['packages'] as List)
            .cast<Map<String, dynamic>>()
            .firstWhere((p) => p['name'] == 'flutter');
        final sdk = Directory.fromUri(Uri.parse(flutter['rootUri'] as String))
            .parent
            .parent;
        await (FontLoader('MaterialIcons')..addFont(
              File(
                '${sdk.path}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
              ).readAsBytes().then(ByteData.sublistView),
            ))
            .load();
      });
      var pressed = 0;
      var selected = -1;
      final boundary = GlobalKey();
      final theme = variant.dark ? BitPosTheme.dark() : BitPosTheme.light();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: theme,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: TextScaler.linear(variant.scale)),
              child: child!,
            ),
            home: Scaffold(
              bottomNavigationBar: NavigationBar(
                selectedIndex: 0,
                onDestinationSelected: (index) => selected = index,
                destinations: [
                  NavigationDestination(
                    icon: const Icon(Icons.home_outlined),
                    label: variant.thai ? 'หน้าแรก' : 'Home',
                  ),
                  NavigationDestination(
                    icon: const Icon(Icons.account_circle_outlined),
                    label: variant.thai ? 'บัญชี' : 'Account',
                  ),
                ],
              ),
              body: SingleChildScrollView(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 660),
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            variant.thai
                                ? 'ยืนยันข้อมูลของคุณ'
                                : 'Review your details',
                            style: theme.textTheme.headlineSmall,
                          ),
                          const SizedBox(height: 20),
                          TextField(
                            decoration: InputDecoration(
                              labelText: variant.thai
                                  ? 'ชื่อที่แสดง'
                                  : 'Display name',
                            ),
                          ),
                          const SizedBox(height: 16),
                          TextField(
                            decoration: InputDecoration(
                              labelText: variant.thai
                                  ? 'เบอร์โทรศัพท์'
                                  : 'Phone number',
                              errorText: variant.thai
                                  ? 'กรุณาตรวจหมายเลขโทรศัพท์'
                                  : 'Check this phone number',
                            ),
                          ),
                          const SizedBox(height: 16),
                          for (final action in BitPosActionVariant.values) ...[
                            BitPosActionButton(
                              key: ValueKey(action.name),
                              label: switch (action) {
                                BitPosActionVariant.primary =>
                                  variant.thai
                                      ? 'บันทึกข้อมูล'
                                      : 'Save details',
                                BitPosActionVariant.secondary =>
                                  variant.thai
                                      ? 'โหลดข้อมูลล่าสุด'
                                      : 'Reload latest details',
                                BitPosActionVariant.outline =>
                                  variant.thai
                                      ? 'กลับไปแก้ไขข้อมูล'
                                      : 'Return to edit details',
                                BitPosActionVariant.danger =>
                                  variant.thai
                                      ? 'ยกเลิกคำขอนี้'
                                      : 'Cancel this request',
                              },
                              icon: action == BitPosActionVariant.primary
                                  ? Icons.check
                                  : null,
                              variant: action,
                              onPressed: () => pressed++,
                            ),
                            const SizedBox(height: 12),
                          ],
                          BitPosActionButton(
                            key: const ValueKey('disabled'),
                            label: variant.thai
                                ? 'บันทึกข้อมูล'
                                : 'Save details',
                            onPressed: null,
                          ),
                          const SizedBox(height: 12),
                          BitPosActionButton(
                            key: const ValueKey('busy'),
                            label: variant.thai ? 'กำลังบันทึก…' : 'Saving…',
                            busy: true,
                            onPressed: () => pressed++,
                          ),
                          const SizedBox(height: 20),
                          Card(
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Text(
                                variant.thai
                                    ? 'รายละเอียดของคุณ'
                                    : 'Your details',
                              ),
                            ),
                          ),
                          const SizedBox(height: 12),
                          BitPosNotice(
                            title: variant.thai
                                ? 'บันทึกข้อมูลเรียบร้อยแล้ว'
                                : 'Details saved',
                            tone: BitPosStatusTone.success,
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            runSpacing: 8,
                            children: [
                              BitPosStatusBadge(
                                label: variant.thai ? 'กำลังทำ' : 'Preparing',
                                tone: BitPosStatusTone.warning,
                              ),
                              BitPosStatusBadge(
                                label: variant.thai ? 'พร้อมรับ' : 'Ready',
                                tone: BitPosStatusTone.success,
                              ),
                              BitPosStatusBadge(
                                label: variant.thai ? 'กำลังส่ง' : 'Delivering',
                                tone: BitPosStatusTone.information,
                              ),
                              BitPosStatusBadge(
                                label: variant.thai
                                    ? 'ยกเลิกแล้ว'
                                    : 'Cancelled',
                                tone: BitPosStatusTone.danger,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump(const Duration(milliseconds: 200));
      expect(tester.takeException(), isNull);
      final primary = find.byKey(const ValueKey('primary'));
      expect(tester.getSize(primary).height, greaterThanOrEqualTo(52));
      await tester.tap(primary);
      await tester.pump();
      expect(pressed, 1);
      await tester.tap(find.byType(NavigationDestination).last);
      await tester.pump();
      expect(selected, 1);
      final disabled = find.descendant(
        of: find.byKey(const ValueKey('disabled')),
        matching: find.byType(FilledButton),
      );
      final busy = find.descendant(
        of: find.byKey(const ValueKey('busy')),
        matching: find.byType(FilledButton),
      );
      expect(tester.widget<FilledButton>(disabled).onPressed, isNull);
      expect(tester.widget<FilledButton>(busy).onPressed, isNull);
      for (final action in BitPosActionVariant.values) {
        expect(
          tester.getSize(find.byKey(ValueKey(action.name))).height,
          greaterThanOrEqualTo(52),
        );
      }
      final captureDir = Platform.environment['BITPOS_DS02_CAPTURE_DIR'];
      if (captureDir != null) {
        await tester.runAsync(() async {
          final image =
              await (boundary.currentContext!.findRenderObject()!
                      as RenderRepaintBoundary)
                  .toImage(pixelRatio: 1);
          final data = await image.toByteData(format: ui.ImageByteFormat.png);
          await File('$captureDir/$name.png').create(exclusive: true);
          await File('$captureDir/$name.png')
              .writeAsBytes(data!.buffer.asUint8List(), flush: true);
          image.dispose();
        });
      }
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }

  testWidgets(
    'tonal controls keep tonal semantics and fields expose error colors',
    (tester) async {
      final theme = BitPosTheme.light();
      await tester.pumpWidget(
        MaterialApp(
          theme: theme,
          home: Scaffold(
            body: Column(
              children: [
                FilledButton(onPressed: () {}, child: const Text('Primary')),
                FilledButton.tonal(
                  onPressed: () {},
                  child: const Text('Secondary'),
                ),
                const TextField(
                  decoration: InputDecoration(errorText: 'Invalid phone'),
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pump();
      final materials = find.byType(Material);
      final paintedColors = tester
          .widgetList<Material>(materials)
          .map((m) => m.color)
          .toList();
      expect(paintedColors, contains(BitPosDesignTokens.primary));
      expect(paintedColors, contains(BitPosDesignTokens.tint));
      final input = Theme.of(tester.element(find.byType(TextField)))
          .inputDecorationTheme;
      expect(
        (input.enabledBorder! as OutlineInputBorder).borderSide.color,
        BitPosDesignTokens.line,
      );
      expect(
        (input.errorBorder! as OutlineInputBorder).borderSide.color,
        BitPosDesignTokens.red,
      );
      expect(find.text('Invalid phone'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
