import 'dart:io';

import 'package:flutter/services.dart';

import 'dart:convert';

import 'driver_sign_in_test.dart' show captureRoot;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/main.dart';
import 'package:bitpos_driver/presentation/driver_application_flow.dart';

import 'driver_identity_test.dart' show DriverApi;

void main() {
  testWidgets(
    'production rider root preserves identity and vehicle draft through staged back navigation',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
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

      FlutterSecureStorage.setMockInitialValues({});
      final api = DriverApi()..empty = true;
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: BitPosTheme.light(),
          home: RepaintBoundary(
            key: const ValueKey('root-capture'),
            child: DriverSessionPage(api: api),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final flow = find.byType(DriverApplicationFlow);
      await tester.scrollUntilVisible(
        flow,
        300,
        scrollable: find.byType(Scrollable).first,
      );
      expect(flow, findsOneWidget);
      final name = find.widgetWithText(TextField, 'ชื่อ–นามสกุล');
      await tester.ensureVisible(name);
      await tester.enterText(name, 'Local rider');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await Scrollable.ensureVisible(tester.element(flow), alignment: 0);
      await tester.pumpAndSettle();
      await captureRoot(tester, 'R03-production-root');
      final next = find.byKey(const ValueKey('driver-application-next'));
      expect(tester.getRect(next).left, 24);
      expect(tester.getRect(next).width, 342);
      expect(tester.getRect(next).bottom, closeTo(756, 1));
      await Scrollable.ensureVisible(tester.element(next), alignment: .5);
      await tester.pumpAndSettle();
      await tester.tap(next);
      await tester.pumpAndSettle();
      expect(
        tester.widget<DriverApplicationFlow>(flow).stage,
        DriverApplicationStage.vehicle,
      );
      final plate = find.widgetWithText(TextField, 'ทะเบียนรถ');
      await tester.ensureVisible(plate);
      await tester.enterText(plate, 'LOCAL-123');
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();
      await Scrollable.ensureVisible(tester.element(flow), alignment: 0);
      await tester.pumpAndSettle();
      await captureRoot(tester, 'R04-production-root');
      await Scrollable.ensureVisible(tester.element(next), alignment: .5);
      await tester.pumpAndSettle();
      await tester.tap(next);
      await tester.pumpAndSettle();
      expect(
        tester.widget<DriverApplicationFlow>(flow).stage,
        DriverApplicationStage.review,
      );
      expect(find.text('ยังไม่มีใบสมัครบนเซิร์ฟเวอร์'), findsOneWidget);
      expect(find.text('Local rider'), findsOneWidget);
      expect(find.text('LOCAL-123'), findsOneWidget);
      expect(find.text('ยังไม่ได้กรอก'), findsWidgets);
      await Scrollable.ensureVisible(tester.element(flow), alignment: 0);
      await tester.pumpAndSettle();
      await captureRoot(tester, 'R05-production-root');
      final submit = find.byKey(const ValueKey('driver-application-submit'));
      await Scrollable.ensureVisible(tester.element(submit), alignment: .5);
      await tester.pumpAndSettle();
      expect(tester.getRect(submit).bottom, lessThanOrEqualTo(772));
      final back = find.byKey(const ValueKey('driver-application-back'));
      await Scrollable.ensureVisible(tester.element(back), alignment: .5);
      await tester.pumpAndSettle();
      await tester.tap(back);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'ทะเบียนรถ'))
            .controller!
            .text,
        'LOCAL-123',
      );
      await Scrollable.ensureVisible(tester.element(back), alignment: .5);
      await tester.pumpAndSettle();
      await tester.tap(back);
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'ชื่อ–นามสกุล'))
            .controller!
            .text,
        'Local rider',
      );
      await tester.tap(find.byKey(const ValueKey('driver-application-back')));
      await tester.pumpAndSettle();
      expect(find.byType(DriverApplicationFlow), findsNothing);
      final reopen = find.byKey(const ValueKey('driver-open-application'));
      await tester.scrollUntilVisible(
        reopen,
        250,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(reopen);
      await tester.tap(reopen);
      await tester.pumpAndSettle();
      expect(find.byType(DriverApplicationFlow), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.widgetWithText(TextField, 'ชื่อ–นามสกุล'))
            .controller!
            .text,
        'Local rider',
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
}
