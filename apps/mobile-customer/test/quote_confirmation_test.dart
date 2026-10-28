import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/quote_confirmation.dart';

void main() {
  testWidgets(
    'finite quote deadline disables confirmation without automatic replacement',
    (tester) async {
      var submits = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: QuoteConfirmation(
              validUntil: DateTime.now()
                  .add(const Duration(seconds: 2))
                  .toUtc()
                  .toIso8601String(),
              thai: false,
              delivery: false,
              blocked: false,
              onConfirm: () => submits++,
            ),
          ),
        ),
      );
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNotNull,
      );
      await tester.pump(const Duration(seconds: 3));
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      expect(find.textContaining('This quote has expired'), findsOneWidget);
      expect(submits, 0);
    },
  );
  testWidgets(
    'pending command and background block fresh confirmation; foreground restores only same valid quote',
    (tester) async {
      final until = DateTime.now()
          .add(const Duration(hours: 1))
          .toUtc()
          .toIso8601String();
      var calls = 0;
      Widget frame(bool blocked) => MaterialApp(
        home: Scaffold(
          body: QuoteConfirmation(
            validUntil: until,
            thai: true,
            delivery: true,
            blocked: blocked,
            onConfirm: () => calls++,
          ),
        ),
      );
      await tester.pumpWidget(frame(true));
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      await tester.pumpWidget(frame(false));
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.scheduleForcedFrame();
      await tester.pump();
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.tap(find.text('ยืนยันออเดอร์จัดส่ง'));
      expect(calls, 1);
      await tester.pumpWidget(const MaterialApp());
    },
  );
}
