import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/presentation/ui_catalog.dart';

void main() {
  for (final size in [const Size(390, 844), const Size(320, 740)]) {
    testWidgets('all14 new UI screens render at $size with large text', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(size);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      for (final thai in [true, false]) {
        for (final id in missingUiScreens.keys) {
          await tester.pumpWidget(
            MaterialApp(
              theme: BitPosTheme.light(),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context)
                    .copyWith(textScaler: const TextScaler.linear(1.5)),
                child: child!,
              ),
              home: UiPreviewRoute(
                key: ValueKey('$id.$thai'),
                id: id,
                thai: thai,
              ),
            ),
          );
          await tester.pump(const Duration(milliseconds: 200));
          expect(find.byType(Scaffold), findsOneWidget, reason: '$id $thai');
          expect(tester.takeException(), isNull, reason: '$id $thai $size');
        }
      }
    });
  }
  testWidgets('coupon selection and PIN validation gate their actions', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: const UiPreviewRoute(id: 'U26', thai: false),
      ),
    );
    await tester.pump();
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    await tester.tap(find.byKey(const ValueKey('coupon.breakfast')));
    await tester.pump();
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: const UiPreviewRoute(id: 'R29', thai: false),
      ),
    );
    await tester.pump();
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    await tester.enterText(find.byKey(const ValueKey('ride-pin-input')), '48');
    await tester.pump();
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
    await tester.enterText(
      find.byKey(const ValueKey('ride-pin-input')),
      '4821',
    );
    await tester.pump();
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('all new screens expose loading empty error and offline states', (
    tester,
  ) async {
    for (final id in missingUiScreens.keys) {
      for (final status in UiPreviewStatus.values.where(
        (s) => s != UiPreviewStatus.ready,
      )) {
        await tester.pumpWidget(
          MaterialApp(
            theme: BitPosTheme.light(),
            home: UiPreviewRoute(
              key: ValueKey('$id.$status'),
              id: id,
              thai: false,
              initialStatus: status,
            ),
          ),
        );
        await tester.pump(const Duration(milliseconds: 100));
        expect(tester.takeException(), isNull, reason: '$id $status');
        if (status == UiPreviewStatus.loading) {
          expect(find.byType(CircularProgressIndicator), findsOneWidget);
        } else {
          expect(find.text('Try again'), findsOneWidget);
        }
      }
    }
  });
  testWidgets('vehicle selection is retained in the next preview route', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: const UiPreviewRoute(id: 'U40', thai: false),
      ),
    );
    await tester.pump();
    await tester.scrollUntilVisible(
      find.byKey(const ValueKey('ride-vehicle.bike')),
      160,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.tap(find.byKey(const ValueKey('ride-vehicle.bike')));
    await tester.pump();
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNotNull,
    );
    await tester.tap(find.text('Confirm ride'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Finding a driver'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('฿65'),
      160,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.text('฿65'), findsWidgets);
    expect(tester.takeException(), isNull);
  });
}
