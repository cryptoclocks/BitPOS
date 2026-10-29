import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_driver/help_safety_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'help_safety_page_test.dart' show HelpApi;

Future<void> _fonts() async {
  for (final family in ['NotoSansThai', 'Inter']) {
    await (FontLoader('packages/mobile_shared/$family')..addFont(
          rootBundle.load('packages/mobile_shared/assets/fonts/$family-Variable.ttf'),
        ))
        .load();
  }
  await (FontLoader('MaterialIcons')..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
}

void main() {
  for (final thai in [true, false]) {
    testWidgets('R20/R21 help and safety 390 ${thai ? 'TH' : 'EN'}', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.reset);
      await _fonts();
      final api = HelpApi();
      addTearDown(api.close);
      final key = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: key,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: BitPosTheme.light(),
            home: DriverHelpSafetyPage(api: api, thai: thai),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final dir = Platform.environment['BITPOS_DS18_CAPTURE_DIR'];
      if (dir == null) return;
      Directory(dir).createSync(recursive: true);
      await tester.runAsync(() async {
        final image = await (key.currentContext!.findRenderObject() as RenderRepaintBoundary).toImage(pixelRatio: 1);
        final data = await image.toByteData(format: ui.ImageByteFormat.png);
        await File('$dir/help-${thai ? 'TH' : 'EN'}.png').writeAsBytes(data!.buffer.asUint8List());
        image.dispose();
      });
    });
  }
}
