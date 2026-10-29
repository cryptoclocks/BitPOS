import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_customer/payment_method_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:mobile_shared/bitpos_theme.dart';

void main() {
  Future<void> mount(
    WidgetTester tester, {
    required bool available,
    required Future<void> Function() open,
    bool thai = false,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: PaymentMethodPage(
          thai: thai,
          total: '2.70 USD',
          checkoutAvailable: available,
          onOpenOriginalCheckout: open,
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('only configured Solana can be selected; one open while busy', (
    tester,
  ) async {
    final gate = Completer<void>();
    var opens = 0;
    await mount(
      tester,
      available: true,
      open: () {
        opens++;
        return gate.future;
      },
    );
    final continueButton = find.byKey(
      const ValueKey('payment-method-continue'),
    );
    expect(tester.widget<FilledButton>(continueButton).onPressed, isNull);
    expect(find.text('PromptPay'), findsOneWidget);
    expect(find.text('Credit / debit card'), findsOneWidget);
    expect(find.text('Not available yet'), findsNWidgets(2));
    await tester.tap(find.byKey(const ValueKey('payment-method-solana')));
    await tester.pump();
    expect(tester.widget<FilledButton>(continueButton).onPressed, isNotNull);
    await tester.tap(continueButton);
    await tester.pump();
    expect(opens, 1);
    expect(tester.widget<FilledButton>(continueButton).onPressed, isNull);
    gate.complete();
    await tester.pumpAndSettle();
    expect(opens, 1);
  });

  testWidgets('missing checkout cannot open any method', (tester) async {
    var opens = 0;
    await mount(
      tester,
      available: false,
      thai: true,
      open: () async {
        opens++;
      },
    );
    await tester.tap(find.byKey(const ValueKey('payment-method-solana')));
    await tester.pump();
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('payment-method-continue')),
          )
          .onPressed,
      isNull,
    );
    expect(find.text('หน้าชำระยังไม่พร้อมใช้งาน'), findsOneWidget);
    expect(opens, 0);
  });

  testWidgets('checkout open error leaves choice recoverable', (tester) async {
    var opens = 0;
    await mount(
      tester,
      available: true,
      open: () async {
        opens++;
        throw StateError('external checkout failed');
      },
    );
    await tester.tap(find.byKey(const ValueKey('payment-method-solana')));
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('payment-method-continue')));
    await tester.pumpAndSettle();
    expect(opens, 1);
    expect(
      find.textContaining('Could not open the original checkout'),
      findsOneWidget,
    );
    expect(
      tester
          .widget<FilledButton>(
            find.byKey(const ValueKey('payment-method-continue')),
          )
          .onPressed,
      isNotNull,
    );
  });

  for (final thai in [true, false]) {
    testWidgets('U16 layout at 390 ${thai ? 'TH' : 'EN'}', (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.reset);
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
      final boundary = GlobalKey();
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
            home: PaymentMethodPage(
              thai: thai,
              total: '2.70 USD',
              checkoutAvailable: true,
              onOpenOriginalCheckout: () async {},
              onNavigate: (_) async {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final first = tester.getRect(
        find.byKey(const ValueKey('payment-method-promptpay')),
      );
      final last = tester.getRect(
        find.byKey(const ValueKey('payment-method-solana')),
      );
      final action = tester.getRect(
        find.byKey(const ValueKey('payment-method-continue')),
      );
      expect(first.left, 24);
      expect(first.width, 342);
      expect(first.height, greaterThanOrEqualTo(82));
      expect(last.bottom, lessThan(action.top));
      final directory = const String.fromEnvironment('BITPOS_DS07_CAPTURE_DIR');
      if (directory.isNotEmpty) {
        await tester.runAsync(() async {
          final image =
              await (boundary.currentContext!.findRenderObject()
                      as RenderRepaintBoundary)
                  .toImage(pixelRatio: 1);
          final data = await image.toByteData(format: ui.ImageByteFormat.png);
          await File('$directory/U16-${thai ? 'TH' : 'EN'}.png')
              .writeAsBytes(data!.buffer.asUint8List());
          await File('$directory/U16-${thai ? 'TH' : 'EN'}.json').writeAsString(
            jsonEncode({
              'first': {
                'x': first.left,
                'y': first.top,
                'w': first.width,
                'h': first.height,
              },
              'last': {
                'x': last.left,
                'y': last.top,
                'w': last.width,
                'h': last.height,
              },
              'action': {
                'x': action.left,
                'y': action.top,
                'w': action.width,
                'h': action.height,
              },
            }),
          );
          image.dispose();
        });
      }
    });
  }
}
