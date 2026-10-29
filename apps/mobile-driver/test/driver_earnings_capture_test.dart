// Local R16–R18 render capture. No backend, payout or device operation.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_driver/earnings_page.dart';
import 'package:bitpos_driver/presentation/driver_navigation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'driver_earnings_surface_test.dart' show EarningsApi, page;

Future<void> _loadFonts() async {
  for (final name in ['NotoSansThai', 'Inter']) {
    final loader = FontLoader('packages/mobile_shared/$name');
    loader.addFont(rootBundle.load(
      'packages/mobile_shared/assets/fonts/$name-Variable.ttf',
    ));
    await loader.load();
  }
  final icons = FontLoader('MaterialIcons');
  icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await icons.load();
}

Future<void> _capture(WidgetTester tester, String name, Rect summary) async {
  final directory = Platform.environment['BITPOS_RIDER_CAPTURE_DIR'];
  if (directory == null) return;
  final output = Directory(directory);
  await output.create(recursive: true);
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('rider-earnings-capture')),
  );
  final image = await boundary.toImage(pixelRatio: 1);
  try {
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('${output.path}/$name.png')
        .writeAsBytes(bytes!.buffer.asUint8List(), flush: true);
    await File('${output.path}/$name.json').writeAsString(jsonEncode({
      'viewport': [390, 844],
      'summary': [summary.left, summary.top, summary.width, summary.height],
      'source': 'local widget fixture; no API, SQL or payout',
    }), flush: true);
  } finally {
    image.dispose();
  }
}

void main() {
  setUpAll(_loadFonts);
  for (final state in [
    (name: 'R16-th-390', thai: true, view: 0),
    (name: 'R17-th-390', thai: true, view: 1),
    (name: 'R18-en-390', thai: false, view: 2),
  ]) {
    testWidgets('capture ${state.name}', (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = EarningsApi()..current = page(readiness: 'PROVIDER_UNAVAILABLE');
      addTearDown(api.close);
      await tester.pumpWidget(MaterialApp(
        theme: BitPosTheme.light(),
        home: MediaQuery(
          data: const MediaQueryData(
            size: Size(390, 844),
            padding: EdgeInsets.only(top: 24, bottom: 24),
          ),
          child: RepaintBoundary(
            key: const ValueKey('rider-earnings-capture'),
            child: DriverDestination(
              api: api,
              thai: state.thai,
              index: 2,
              child: DriverEarningsPage(api: api, thai: state.thai),
            ),
          ),
        ),
      ));
      await tester.pumpAndSettle();
      if (state.view >= 1) {
        await tester.tap(find.text(state.thai ? 'รอบจ่าย' : 'Payouts'));
        await tester.pumpAndSettle();
      }
      if (state.view == 2) {
        await tester.tap(find.text('Referenced payout round'));
        await tester.pumpAndSettle();
      }
      final summary = tester.getRect(
        find.byKey(const ValueKey('driver-earnings-summary')),
      );
      expect(summary.left, closeTo(24, 0.1));
      expect(summary.width, closeTo(342, 0.1));
      expect(tester.takeException(), isNull);
      await tester.runAsync(() => _capture(tester, state.name, summary));
    });
  }
}
