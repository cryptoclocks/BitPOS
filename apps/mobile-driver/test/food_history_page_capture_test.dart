// Local R15 render capture only; no backend, payment, or device operations.
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_driver/food_history_page.dart';
import 'package:bitpos_driver/presentation/driver_history_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'food_history_page_test.dart' show HistoryApi;

Future<void> _capture(
  WidgetTester tester,
  String name,
  Map<String, Object?> geometry,
) async {
  final directory = Platform.environment['BITPOS_RIDER_CAPTURE_DIR'];
  if (directory == null) return;
  final output = Directory(directory);
  await output.create(recursive: true);
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('r15-history-capture')),
  );
  final image = await boundary.toImage(pixelRatio: 1);
  try {
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('${output.path}/$name.png')
        .writeAsBytes(bytes!.buffer.asUint8List(), flush: true);
    await File('${output.path}/$name.json')
        .writeAsString(jsonEncode(geometry), flush: true);
  } finally {
    image.dispose();
  }
}

Future<void> _loadCaptureFonts() async {
  for (final name in ['NotoSansThai', 'Inter']) {
    final loader = FontLoader('packages/mobile_shared/$name');
    loader.addFont(
      rootBundle.load('packages/mobile_shared/assets/fonts/$name-Variable.ttf'),
    );
    await loader.load();
  }
  final icons = FontLoader('MaterialIcons');
  icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await icons.load();
}

void main() {
  setUpAll(_loadCaptureFonts);
  for (final state in [
    (name: 'r15-history-th-390', width: 390.0, thai: true),
    (name: 'r15-history-en-1440', width: 1440.0, thai: false),
  ]) {
    testWidgets('R15 captures ${state.name}', (tester) async {
      tester.view.physicalSize = Size(state.width, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = HistoryApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: BitPosTheme.light(),
          home: RepaintBoundary(
            key: const ValueKey('r15-history-capture'),
            child: DriverFoodHistoryPage(api: api, thai: state.thai),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final card = find.byType(DriverHistoryCard);
      expect(card, findsOneWidget);
      final rect = tester.getRect(card);
      expect(
        rect.left,
        closeTo(state.width < 980 ? 24 : (state.width - 980) / 2 + 24, 0.1),
      );
      expect(
        rect.width,
        closeTo(state.width < 980 ? state.width - 48 : 932, 0.1),
      );
      final header = tester.getRect(
        find.text(state.thai ? 'ประวัติการรับงาน' : 'Delivery history'),
      );
      await tester.runAsync(
        () => _capture(tester, state.name, {
          'screen': 'R15',
          'locale': state.thai ? 'th' : 'en',
          'viewport': [state.width, 844],
          'card': [rect.left, rect.top, rect.width, rect.height],
          'header': [header.left, header.top, header.width, header.height],
          'reference': {
            'mobileCard': [24, 228, 342, 82],
            'mobileFilter': [24, 136, 90, 30],
          },
        }),
      );
      expect(tester.takeException(), isNull);
    });
  }
}
