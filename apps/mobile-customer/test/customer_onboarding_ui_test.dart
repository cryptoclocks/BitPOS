import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/customer_location_access.dart';
import 'package:bitpos_customer/presentation/customer_location_permission.dart';
import 'package:bitpos_customer/presentation/customer_notification_permission.dart';
import 'package:bitpos_customer/presentation/customer_welcome.dart';
import 'package:bitpos_customer/presentation/customer_sign_in.dart';
import 'package:mobile_shared/bitpos_theme.dart';

Future<void> loadFonts(WidgetTester tester) async {
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
}

void main() {
  for (final variant in [
    (390.0, 1.0, false),
    (320.0, 1.5, true),
    (1280.0, 1.5, false),
  ]) {
    testWidgets(
      'OTP six cells preserve paste autofill validation ${variant.$1}',
      (tester) async {
        await tester.binding.setSurfaceSize(Size(variant.$1, 844));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        final code = TextEditingController();
        final form = GlobalKey<FormState>();
        await tester.pumpWidget(
          MaterialApp(
            theme: variant.$3 ? BitPosTheme.dark() : BitPosTheme.light(),
            home: Scaffold(
              body: MediaQuery(
                data: MediaQueryData(textScaler: TextScaler.linear(variant.$2)),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Form(
                    key: form,
                    child: CustomerOtpField(
                      controller: code,
                      enabled: true,
                      label: 'Six-digit code',
                      invalidMessage: 'Enter six digits',
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        final input = find.byKey(const ValueKey('customer-otp-input'));
        expect(
          tester
              .widget<TextField>(
                find.descendant(of: input, matching: find.byType(TextField)),
              )
              .autofillHints,
          contains(AutofillHints.oneTimeCode),
        );
        await tester.enterText(input, '12x34567');
        await tester.pump();
        expect(code.text, '123456');
        expect(form.currentState!.validate(), true);
        for (final digit in ['1', '2', '3', '4', '5', '6']) {
          expect(find.text(digit), findsOneWidget);
        }
        await tester.enterText(input, '12');
        expect(form.currentState!.validate(), false);
        await tester.pump();
        expect(find.text('Enter six digits'), findsWidgets);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
        code.dispose();
      },
    );
  }

  for (final variant in [
    (thai: true, width: 390.0, scale: 1.0, dark: false),
    (thai: false, width: 390.0, scale: 1.0, dark: false),
    (thai: true, width: 320.0, scale: 1.5, dark: true),
    (thai: false, width: 1280.0, scale: 1.5, dark: false),
  ]) {
    final name =
        '${variant.thai ? 'th' : 'en'}-${variant.width.toInt()}-${variant.scale}-${variant.dark ? 'dark' : 'light'}';
    testWidgets('onboarding renders and keeps explicit callbacks $name', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = Size(variant.width, 844);
      addTearDown(tester.view.reset);
      await loadFonts(tester);
      final boundary = GlobalKey();
      var allow = 0, skip = 0, back = 0;
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
      Future<void> capture(String id) async {
        final dir = Platform.environment['BITPOS_DS03_CAPTURE_DIR'];
        if (dir == null) return;
        final render =
            boundary.currentContext!.findRenderObject()!
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await render.toImage(pixelRatio: 1);
          final data = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File('$dir/$id-$name.png');
          await file.create(exclusive: true);
          await file.writeAsBytes(data!.buffer.asUint8List());
          image.dispose();
        });
      }

      await tester.pumpWidget(
        app(
          CustomerLocationPermission(
            thai: variant.thai,
            busy: false,
            status: CustomerLocationStatus.initial,
            onAllow: () => allow++,
            onSkip: () => skip++,
            onSettings: () {},
            onBack: () => back++,
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      final icon = tester.getRect(
        find.byKey(const ValueKey('customer-location-icon')),
      );
      expect(icon.size, const Size(120, 120));
      if (variant.width == 390 && variant.scale == 1) {
        expect(icon.left, 135);
        expect(icon.top, 170);
        final action = tester.getRect(
          find.byKey(const ValueKey('customer-location-primary')),
        );
        expect(action.left, 24);
        expect(action.width, 342);
        expect(action.top, closeTo(622, 1));
      }
      await capture('U04');
      await tester.ensureVisible(
        find.byKey(const ValueKey('customer-location-primary')),
      );
      await tester.tap(find.byKey(const ValueKey('customer-location-primary')));
      expect(allow, 1);
      await tester.ensureVisible(
        find.byKey(const ValueKey('customer-location-skip')),
      );
      await tester.tap(find.byKey(const ValueKey('customer-location-skip')));
      expect(skip, 1);
      await tester.pumpWidget(
        app(
          CustomerNotificationPermission(
            thai: variant.thai,
            busy: false,
            available: true,
            enabled: false,
            onAllow: () => allow++,
            onSkip: () => skip++,
            onBack: () => back++,
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(allow, 1, reason: 'merely mounting U05 never opts in');
      await capture('U05');
      await tester.ensureVisible(
        find.byKey(const ValueKey('customer-notification-primary')),
      );
      await tester.tap(
        find.byKey(const ValueKey('customer-notification-primary')),
      );
      expect(allow, 2);
      await tester.ensureVisible(
        find.byKey(const ValueKey('customer-notification-skip')),
      );
      await tester.tap(
        find.byKey(const ValueKey('customer-notification-skip')),
      );
      expect(skip, 2);
      await tester.pumpWidget(
        app(
          CustomerNotificationPermission(
            thai: variant.thai,
            busy: false,
            available: false,
            enabled: false,
            onAllow: () => allow++,
            onSkip: () => skip++,
            onBack: () => back++,
          ),
        ),
      );
      await tester.pump();
      final disabled = tester.widget<FilledButton>(
        find.byKey(const ValueKey('customer-notification-primary')),
      );
      expect(disabled.onPressed, isNull);
      await tester.ensureVisible(
        find.byKey(const ValueKey('customer-notification-skip')),
      );
      await tester.tap(
        find.byKey(const ValueKey('customer-notification-skip')),
      );
      expect(skip, 3);
      await tester.pumpWidget(
        app(
          CustomerNotificationPermission(
            thai: variant.thai,
            busy: true,
            available: true,
            enabled: false,
            onAllow: () => allow++,
            onSkip: () => skip++,
            onBack: () => back++,
          ),
        ),
      );
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('customer-notification-primary')),
            )
            .onPressed,
        isNull,
      );
      expect(
        tester
            .widget<OutlinedButton>(
              find.byKey(const ValueKey('customer-notification-skip')),
            )
            .onPressed,
        isNull,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(
        app(
          CustomerWelcome(
            thai: variant.thai,
            onStart: () => allow++,
            onLanguage: () => back++,
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      if (variant.width == 390 && variant.scale == 1) {
        final hero = tester.getRect(
          find.byKey(const ValueKey('customer-welcome-artwork')),
        );
        expect(hero.top, 108);
        expect(hero.size, const Size(342, 304));
      }
      await capture('U01');
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('customer-welcome-start')),
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(find.byKey(const ValueKey('customer-welcome-start')));
      expect(allow, 3);
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets('notification error and already-enabled state remain truthful', (
    tester,
  ) async {
    var allow = 0, skipped = 0;
    Widget page({bool enabled = false, String? error}) => MaterialApp(
      theme: BitPosTheme.light(),
      home: CustomerNotificationPermission(
        thai: false,
        busy: false,
        available: true,
        enabled: enabled,
        error: error,
        onAllow: () => allow++,
        onSkip: () => skipped++,
        onBack: () {},
      ),
    );
    await tester.pumpWidget(
      page(error: 'Permission was not allowed. Try again or continue.'),
    );
    expect(
      find.text('Permission was not allowed. Try again or continue.'),
      findsOneWidget,
    );
    await tester.ensureVisible(
      find.byKey(const ValueKey('customer-notification-primary')),
    );
    await tester.tap(
      find.byKey(const ValueKey('customer-notification-primary')),
    );
    expect(allow, 1);
    await tester.pumpWidget(page(enabled: true));
    await tester.ensureVisible(
      find.byKey(const ValueKey('customer-notification-primary')),
    );
    await tester.tap(
      find.byKey(const ValueKey('customer-notification-primary')),
    );
    expect(skipped, 1);
    expect(
      allow,
      1,
      reason: 'already enabled continues without enabling again',
    );
    expect(tester.takeException(), isNull);
  });
}
