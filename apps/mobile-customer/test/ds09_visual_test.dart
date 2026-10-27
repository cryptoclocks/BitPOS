import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_customer/food_cancellation_review_page.dart';
import 'package:bitpos_customer/order_history_sheet.dart';
import 'package:bitpos_customer/order_refunds_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_history_test.dart' as history;
import 'food_refunds_test.dart' as refunds;
import 'food_root_navigation_test.dart' show RootChatApi;

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

Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  final directory = const String.fromEnvironment('BITPOS_DS09_CAPTURE_DIR');
  if (directory.isEmpty) return;
  Directory(directory).createSync(recursive: true);
  await tester.pump();
  await tester.runAsync(() async {
    final image =
        await (key.currentContext!.findRenderObject() as RenderRepaintBoundary)
            .toImage(pixelRatio: 1);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('$directory/$name.png').writeAsBytes(data!.buffer.asUint8List());
    await File('$directory/$name.json').writeAsString(
      jsonEncode({
        'size': {'width': image.width, 'height': image.height},
      }),
    );
    image.dispose();
  });
}

Future<GlobalKey> _mount(WidgetTester tester, Widget child) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(390, 844);
  addTearDown(tester.view.reset);
  await _fonts();
  final key = GlobalKey();
  await tester.pumpWidget(
    RepaintBoundary(
      key: key,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            padding: const EdgeInsets.only(top: 44, bottom: 34),
            viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
          ),
          child: child!,
        ),
        home: child,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return key;
}

void main() {
  for (final thai in [true, false]) {
    testWidgets('U23 390 ${thai ? 'TH' : 'EN'} visual', (tester) async {
      final api = history.HistoryApi();
      addTearDown(api.close);
      final now = DateTime(2026, 10, 26, 10);
      final key = await _mount(
        tester,
        OrderHistorySheet(
          api: api,
          firstPage: MobileFoodOrders(
            orders: [
              history.summary(1, createdAt: now.toUtc().toIso8601String()),
              history.summary(
                2,
                createdAt: now
                    .subtract(const Duration(days: 1))
                    .toUtc()
                    .toIso8601String(),
              ),
              history.summary(
                3,
                createdAt: now
                    .subtract(const Duration(days: 9))
                    .toUtc()
                    .toIso8601String(),
              ),
            ],
            nextCursor: null,
          ),
          thai: thai,
          clock: () => now,
          onAuthenticationRequired: () {},
          onNavigate: (_) {},
        ),
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U23-${thai ? 'TH' : 'EN'}');
    });
    testWidgets('U24 390 ${thai ? 'TH' : 'EN'} visual', (tester) async {
      final api = RootChatApi();
      addTearDown(api.close);
      final key = await _mount(
        tester,
        FoodCancellationReviewPage(
          api: api,
          orderId: history.id(1),
          shipmentId: history.id(2),
          thai: thai,
          owner: null,
          onAuthenticationRequired: () {},
          onNavigationSelected: (_) {},
        ),
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U24-${thai ? 'TH' : 'EN'}');
    });
    testWidgets('U25 390 ${thai ? 'TH' : 'EN'} visual', (tester) async {
      final api = refunds.RefundApi();
      addTearDown(api.close);
      final key = await _mount(
        tester,
        OrderRefundsSheet(
          api: api,
          orderId: history.id(100),
          order: history.order(100),
          firstPage: MobileFoodRefunds(
            refunds: [refunds.refund(1)],
            nextCursor: null,
            generation: '1',
          ),
          thai: thai,
          onAuthenticationRequired: () {},
          onViewOrder: () {},
          onContactSupport: () {},
          onNavigation: (_) {},
        ),
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U25-${thai ? 'TH' : 'EN'}');
    });
  }
}
