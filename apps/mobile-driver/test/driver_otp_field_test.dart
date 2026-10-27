import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/presentation/driver_otp_field.dart';

void main() {
  for (final scenario in [
    (true, false, 390.0, 1.0),
    (false, false, 390.0, 1.0),
    (true, true, 320.0, 1.5),
    (false, false, 1280.0, 1.5),
  ]) {
    testWidgets('six OTP cells retain input/autofill/validation $scenario', (
      tester,
    ) async {
      final (thai, dark, width, scale) = scenario;
      await tester.binding.setSurfaceSize(Size(width, 844));
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
      });
      final controller = TextEditingController();
      addTearDown(controller.dispose);
      final form = GlobalKey<FormState>();
      final boundary = GlobalKey();
      final label = thai ? 'รหัส OTP' : 'OTP code',
          error = thai ? 'กรอกรหัส 6 หลัก' : 'Enter six digits';
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: dark ? BitPosTheme.dark() : BitPosTheme.light(),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: TextScaler.linear(scale)),
            child: child!,
          ),
          home: RepaintBoundary(
            key: boundary,
            child: Scaffold(
              body: Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 520),
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Form(
                      key: form,
                      child: DriverOtpField(
                        controller: controller,
                        enabled: true,
                        label: label,
                        invalidMessage: error,
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
      expect(form.currentState!.validate(), false);
      await tester.pump();
      final field = find.byType(TextFormField);
      expect(field, findsOneWidget);
      final semantics = tester.ensureSemantics();
      expect(find.bySemanticsLabel(label), findsWidgets);
      semantics.dispose();
      await tester.enterText(field, '12x34567');
      await tester.pump();
      expect(controller.text, '123456');
      expect(form.currentState!.validate(), true);
      for (final digit in ['1', '2', '3', '4', '5', '6'])
        expect(find.text(digit), findsOneWidget);
      final input = tester.widget<TextFormField>(field);
      expect(input.enabled, true);
      expect(
        tester.widget<EditableText>(find.byType(EditableText)).autofillHints,
        contains(AutofillHints.oneTimeCode),
      );
      expect(tester.takeException(), isNull);
      final out = Platform.environment['BITPOS_DS14_OTP_CAPTURE_DIR'];
      if (out != null) {
        await tester.runAsync(() async {
          final image = await (tester.renderObject(
            find.byKey(boundary),
          ) as RenderRepaintBoundary).toImage(pixelRatio: 1);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          await File(
            '$out/otp-${thai ? 'th' : 'en'}-${dark ? 'dark' : 'light'}-${width.toInt()}-$scale.png',
          ).writeAsBytes(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
      await tester.pumpWidget(const SizedBox.shrink());
    });
  }
}
