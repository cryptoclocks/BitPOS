import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_customer/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_history_test.dart' as fixture;
import 'food_root_navigation_test.dart' show RootChatApi;
import 'notification_owner_test.dart' show PushNative;

class StatusVisualApi extends RootChatApi {
  StatusVisualApi(this.phase, {required this.thai});

  final String phase;
  final bool thai;
  bool failOrderRead = false;
  int eventReads = 0;

  @override
  Future<void> restore() async {}

  @override
  Future<MobileAccount> account() async => MobileAccount(
    id: fixture.id(50),
    displayName: 'Synthetic customer',
    locale: thai ? 'th' : 'en',
  );

  @override
  Future<String?> activeFoodOrderId() async => fixture.id(1);

  @override
  Future<MobileFoodEvents> foodEvents(String id, {String? cursor}) async {
    eventReads++;
    if (failOrderRead) throw const SocketException('fixture offline');
    return MobileFoodEvents(
      order: deliveredOrder,
      events: [],
      nextCursor: null,
    );
  }

  @override
  MobileFoodOrder get deliveredOrder => MobileFoodOrder.fromJson({
    ...super.deliveredOrder.toJson(),
    'status': phase == 'CONFIRMING' ? 'CONFIRMING' : 'PAID',
    'acceptanceStatus': phase == 'CONFIRMING'
        ? 'PENDING'
        : ['REJECTED', 'TIMED_OUT'].contains(phase)
        ? phase
        : 'ACCEPTED',
    'fulfillmentStatus': ['RECEIVED', 'PREPARING'].contains(phase)
        ? phase
        : 'RECEIVED',
  });
}

Future<void> _loadFonts() async {
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

Future<void> _capture(
  WidgetTester tester,
  GlobalKey boundary,
  String name,
  Map<String, Rect> geometry,
) async {
  final directory = const String.fromEnvironment('BITPOS_DS07_CAPTURE_DIR');
  if (directory.isEmpty) return;
  Directory(directory).createSync(recursive: true);
  await tester.pump();
  await tester.runAsync(() async {
    final image =
        await (boundary.currentContext!.findRenderObject()
                as RenderRepaintBoundary)
            .toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('$directory/$name.png')
        .writeAsBytes(bytes!.buffer.asUint8List());
    await File('$directory/$name.json').writeAsString(
      jsonEncode({
        for (final entry in geometry.entries)
          entry.key: {
            'x': entry.value.left,
            'y': entry.value.top,
            'w': entry.value.width,
            'h': entry.value.height,
          },
      }),
    );
    image.dispose();
  });
}

void main() {
  for (final phase in ['CONFIRMING', 'RECEIVED', 'PREPARING']) {
    for (final thai in [true, false]) {
      testWidgets('$phase owned status 390 ${thai ? 'TH' : 'EN'}', (
        tester,
      ) async {
        FlutterSecureStorage.setMockInitialValues({});
        tester.view.devicePixelRatio = 1;
        tester.view.physicalSize = const Size(390, 844);
        addTearDown(tester.view.reset);
        await _loadFonts();
        final boundary = GlobalKey();
        final api = StatusVisualApi(phase, thai: thai);
        addTearDown(api.close);
        await tester.pumpWidget(
          RepaintBoundary(
            key: boundary,
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
              home: CustomerSessionPage(api: api, pushNative: PushNative()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        final summary = find.byKey(
          ValueKey(
            'food-order-phase.${phase == 'CONFIRMING'
                ? 'paymentPending'
                : phase == 'RECEIVED'
                ? 'accepted'
                : 'preparing'}',
          ),
        );
        expect(summary, findsOneWidget);
        final rect = tester.getRect(summary);
        expect(rect.width, greaterThan(300));
        if (phase == 'CONFIRMING') {
          expect(
            find.byKey(const ValueKey('customer-order-status-primary-action')),
            findsOneWidget,
          );
          expect(
            find.text(thai ? 'ติดต่อช่วยเหลือ' : 'Contact support'),
            findsOneWidget,
          );
        } else {
          expect(
            find.byKey(const ValueKey('customer-order-detail-track-action')),
            findsOneWidget,
          );
          expect(
            find.byKey(
              const ValueKey('customer-order-status-secondary-action'),
            ),
            findsOneWidget,
          );
        }
        await _capture(tester, boundary, '$phase-${thai ? 'TH' : 'EN'}', {
          'summary': rect,
        });
        if (phase == 'PREPARING' && thai) {
          final detail = find.text('ดูรายละเอียดออเดอร์');
          await tester.ensureVisible(detail);
          await tester.tap(detail);
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(
            find.byKey(const ValueKey('order-detail-cancel-review')),
            findsOneWidget,
          );
          expect(find.textContaining('กำหนดรับออเดอร์'), findsNothing);
          await _capture(tester, boundary, 'U22-TH', {});
          await tester.tap(
            find.byKey(const ValueKey('order-detail-status-history')),
          );
          await tester.pumpAndSettle();
          expect(find.textContaining('กำหนดรับออเดอร์'), findsOneWidget);
        }
      });
    }
  }
  for (final phase in ['REJECTED', 'TIMED_OUT']) {
    testWidgets('$phase keeps the original order and blocks delivery action', (
      tester,
    ) async {
      FlutterSecureStorage.setMockInitialValues({});
      final api = StatusVisualApi(phase, thai: true);
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: BitPosTheme.light(),
          home: CustomerSessionPage(api: api, pushNative: PushNative()),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('ร้านไม่ดำเนินการออเดอร์นี้'),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('customer-order-detail-track-action')),
        findsNothing,
      );
      final cancel = tester.widget<OutlinedButton>(
        find.byKey(const ValueKey('order-detail-cancel-review')),
      );
      expect(cancel.onPressed, isNull);
      expect(api.eventReads, greaterThanOrEqualTo(1));
    });
  }
  testWidgets('offline pending refresh preserves the original order', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({});
    final api = StatusVisualApi('CONFIRMING', thai: true);
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: CustomerSessionPage(api: api, pushNative: PushNative()),
      ),
    );
    await tester.pumpAndSettle();
    api.failOrderRead = true;
    await tester.tap(
      find.byKey(const ValueKey('customer-order-status-primary-action')),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('food-action-error')), findsOneWidget);
    expect(find.text('กำลังตรวจสอบการชำระเงิน'), findsWidgets);
    expect(api.eventReads, greaterThanOrEqualTo(2));
  });
}
