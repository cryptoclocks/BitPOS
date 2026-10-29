import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/presentation/driver_application_flow.dart';
import 'package:bitpos_driver/presentation/driver_welcome.dart';

void main() {
  for (final variant in [
    (thai: true, dark: false, width: 390.0, scale: 1.0),
    (thai: false, dark: false, width: 390.0, scale: 1.0),
    (thai: true, dark: true, width: 320.0, scale: 1.5),
    (thai: false, dark: false, width: 1440.0, scale: 1.5),
  ]) {
    final tag =
        '${variant.thai ? 'th' : 'en'}-${variant.dark ? 'dark' : 'light'}-${variant.width.toInt()}-${variant.scale}';
    testWidgets('rider welcome and application navigation $tag', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(variant.width, 844);
      addTearDown(tester.view.reset);
      await tester.runAsync(() async {
        for (final family in ['NotoSansThai', 'Inter']) {
          await (FontLoader('packages/mobile_shared/$family')..addFont(
                File(
                  '../../packages/mobile_shared/assets/fonts/$family-Variable.ttf',
                ).readAsBytes().then(ByteData.sublistView),
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
      final boundary = GlobalKey();
      Widget app(Widget child) => RepaintBoundary(
        key: boundary,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: variant.dark ? BitPosTheme.dark() : BitPosTheme.light(),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: TextScaler.linear(variant.scale),
              padding: const EdgeInsets.only(top: 44, bottom: 34),
            ),
            child: child!,
          ),
          home: child,
        ),
      );
      Future<void> capture(String screen) async {
        final output = Platform.environment['BITPOS_DS14_CAPTURE_DIR'];
        if (output == null) return;
        await tester.pump(const Duration(milliseconds: 200));
        await tester.runAsync(() async {
          final image =
              await (boundary.currentContext!.findRenderObject()
                      as RenderRepaintBoundary)
                  .toImage(pixelRatio: 1);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File('$output/$screen-$tag.png');
          await file.create(exclusive: true);
          await file.writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }

      var starts = 0, languages = 0;
      await tester.pumpWidget(
        app(
          DriverWelcome(
            thai: variant.thai,
            onStart: () => starts++,
            onLanguage: () => languages++,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(starts, 0);
      expect(
        find.text(variant.thai ? 'แผนที่ตัวอย่าง' : 'Map illustration'),
        findsOneWidget,
      );
      if (variant.width == 390) await capture('R01');
      await tester.tap(find.text(variant.thai ? 'English' : 'ไทย'));
      expect(languages, 1);
      final start = find.byKey(const ValueKey('driver-welcome-start'));
      await tester.scrollUntilVisible(
        start,
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(start);
      expect(starts, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());

      final name = TextEditingController(), plate = TextEditingController();
      addTearDown(name.dispose);
      addTearDown(plate.dispose);
      var stage = DriverApplicationStage.identity, submits = 0;
      await tester.pumpWidget(
        app(
          StatefulBuilder(
            builder: (context, setState) => Scaffold(
              body: SafeArea(
                child: Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 520),
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
                      child: DriverApplicationFlow(
                        thai: variant.thai,
                        stage: stage,
                        editable: true,
                        reviewDetails: {
                          variant.thai ? 'ชื่อ–นามสกุล' : 'Display name':
                              name.text,
                          variant.thai ? 'ทะเบียนรถ' : 'Vehicle plate':
                              plate.text,
                          variant.thai ? 'ยี่ห้อรถ' : 'Vehicle brand': 'A long vehicle manufacturer and model description',
                          variant.thai ? 'สีรถ' : 'Vehicle color': '',
                        },
                        identityFields: [
                          TextField(
                            key: const ValueKey('name'),
                            controller: name,
                            decoration: InputDecoration(
                              labelText: variant.thai
                                  ? 'ชื่อ–นามสกุล'
                                  : 'Display name',
                            ),
                          ),
                        ],
                        vehicleFields: [
                          TextField(
                            key: const ValueKey('plate'),
                            controller: plate,
                            decoration: InputDecoration(
                              labelText: variant.thai
                                  ? 'ทะเบียนรถ'
                                  : 'Vehicle plate',
                            ),
                          ),
                        ],
                        verificationStatus: variant.thai
                            ? 'รอตรวจสอบ'
                            : 'Pending review',
                        decisionReason: '',
                        verifiedUntil: null,
                        onBack: stage == DriverApplicationStage.identity
                            ? null
                            : () => setState(() => stage = stage.previous),
                        onNext: () => setState(() => stage = stage.next),
                        onSubmit: () => submits++,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('name')),
        'Fixture Rider',
      );
      if (variant.width == 390 && variant.thai) await capture('R03');
      final next = find.byKey(const ValueKey('driver-application-next'));
      await tester.ensureVisible(next);
      await tester.pumpAndSettle();
      expect(tester.getSize(next).height, greaterThanOrEqualTo(52));
      await tester.tap(next);
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('plate')), 'FIXTURE 01');
      if (variant.width == 390 && variant.thai) await capture('R04');
      await tester.ensureVisible(
        find.byKey(const ValueKey('driver-application-back')),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('driver-application-back')));
      await tester.pumpAndSettle();
      expect(name.text, 'Fixture Rider');
      await tester.ensureVisible(next);
      await tester.pumpAndSettle();
      await tester.tap(next);
      await tester.pumpAndSettle();
      expect(plate.text, 'FIXTURE 01');
      await tester.ensureVisible(next);
      await tester.pumpAndSettle();
      await tester.tap(next);
      await tester.pumpAndSettle();
      expect(
        find.text(variant.thai ? 'รอตรวจสอบ' : 'Pending review'),
        findsOneWidget,
      );
      expect(submits, 0);
      if (variant.width != 390 || variant.thai) await capture('R05');
      final submit = find.byKey(const ValueKey('driver-application-submit'));
      await tester.ensureVisible(submit);
      await tester.pumpAndSettle();
      await tester.tap(submit);
      expect(submits, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
  testWidgets('read-only review never invents verification or enables submit', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.dark(),
        home: Scaffold(
          body: DriverApplicationFlow(
            thai: false,
            stage: DriverApplicationStage.review,
            editable: false,
            identityFields: const [],
            vehicleFields: const [],
            verificationStatus: 'Rejected',
            decisionReason: 'Local fixture reason',
            verifiedUntil: null,
            onNext: () {},
            onSubmit: null,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final button = tester.widget<FilledButton>(
      find.byKey(const ValueKey('driver-application-submit')),
    );
    expect(button.onPressed, isNull);
    expect(find.text('Rejected'), findsOneWidget);
    expect(find.text('Local fixture reason'), findsOneWidget);
    expect(find.textContaining('Verified until'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
