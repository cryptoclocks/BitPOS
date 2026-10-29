import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_driver/presentation/passenger_preview_pages.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';

Future<void> _fonts() async {
  for (final family in ['NotoSansThai', 'Inter']) {
    await (FontLoader('packages/mobile_shared/$family')..addFont(
          rootBundle.load(
            'packages/mobile_shared/assets/fonts/$family-Variable.ttf',
          ),
        ))
        .load();
  }
  await (FontLoader(
    'MaterialIcons',
  )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
}

void main() {
  testWidgets(
    'R27-R31 walk forward and back; every primary action stays disabled',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        const MaterialApp(home: PassengerOfferPreviewPage(thai: false)),
      );
      for (final marker in [
        'Accept this job',
        'I have arrived',
        'Confirm PIN and start',
        'Arrived at destination',
      ]) {
        expect(
          find.byKey(const ValueKey('passenger-sample-badge')),
          findsOneWidget,
        );
        expect(
          tester
              .widget<FilledButton>(find.widgetWithText(FilledButton, marker))
              .onPressed,
          isNull,
        );
        await tester.ensureVisible(
          find.byKey(const ValueKey('passenger-next-sample')),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('passenger-next-sample')));
        await tester.pumpAndSettle();
      }
      expect(find.text('Trip summary'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Back to work'),
            )
            .onPressed,
        isNull,
      );
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Navigate to destination'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  for (final thai in [true, false]) {
    final pages = {
      'R27': PassengerOfferPreviewPage(thai: thai),
      'R28': PassengerArrivalPreviewPage(thai: thai),
      'R29': PassengerPinPreviewPage(thai: thai),
      'R30': PassengerTripPreviewPage(thai: thai),
      'R31': PassengerCompletePreviewPage(thai: thai),
    };
    for (final e in pages.entries) {
      testWidgets('${e.key} 390 ${thai ? 'TH' : 'EN'}', (tester) async {
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        await _fonts();
        final key = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: key,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: BitPosTheme.light(),
              home: e.value,
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final dir = Platform.environment['BITPOS_DS19_CAPTURE_DIR'];
        if (dir == null) return;
        Directory(dir).createSync(recursive: true);
        await tester.runAsync(() async {
          final image =
              await (key.currentContext!.findRenderObject()
                      as RenderRepaintBoundary)
                  .toImage(pixelRatio: 1);
          final data = await image.toByteData(format: ui.ImageByteFormat.png);
          await File('$dir/${e.key}-${thai ? 'TH' : 'EN'}.png')
              .writeAsBytes(data!.buffer.asUint8List());
          image.dispose();
        });
      });
    }
  }
}
