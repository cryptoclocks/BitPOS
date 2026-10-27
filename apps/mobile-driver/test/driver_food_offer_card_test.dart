import 'dart:ui' show SemanticsAction;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/presentation/driver_food_offer_card.dart';

Widget _offer({
  required DateTime? deadline,
  bool thai = false,
  VoidCallback? onAccept,
  VoidCallback? onDecline,
}) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: DriverFoodOfferCard(
        thai: thai,
        deadline: deadline,
        expiryLabel: 'New offer · accept by 12:34',
        earning: '100 THB',
        pickup: '13.745, 100.535',
        onAccept: onAccept,
        declineAction: TextButton(
          onPressed: onDecline,
          child: const Text('Decline with reason'),
        ),
      ),
    ),
  ),
);

void main() {
  for (final thai in [true, false]) {
    testWidgets('deadline expires both actions without owner rebuild $thai', (
      tester,
    ) async {
      final semantics = tester.ensureSemantics();
      var accepted = 0, declined = 0;
      final deadline = DateTime.now().add(const Duration(minutes: 1));
      await tester.pumpWidget(_offer(
        deadline: deadline,
        thai: thai,
        onAccept: () => accepted++,
        onDecline: () => declined++,
      ));
      await tester.tap(find.text(thai ? 'รับงานนี้' : 'Accept this offer'));
      await tester.tap(find.text('Decline with reason'));
      expect(accepted, 1);
      expect(declined, 1);
      await tester.pump(const Duration(seconds: 59));
      expect(find.text('New offer · accept by 12:34'), findsOneWidget);
      await tester.pump(const Duration(seconds: 1));
      expect(
        find.text(thai ? 'ข้อเสนองานหมดอายุแล้ว' : 'Offer expired'),
        findsOneWidget,
      );
      expect(
        tester.getSemantics(find.byType(FilledButton)).getSemanticsData()
            .hasAction(SemanticsAction.tap),
        isFalse,
      );
      expect(
        tester.getSemantics(find.byType(Scaffold)).toStringDeep(),
        isNot(contains('Decline with reason')),
      );
      await tester.tap(find.text(thai ? 'รับงานนี้' : 'Accept this offer'));
      await tester.tap(find.text('Decline with reason'), warnIfMissed: false);
      expect(accepted, 1);
      expect(declined, 1);
      semantics.dispose();
    });
  }

  testWidgets('replacing deadline cancels the old deadline and rearms expiry', (
    tester,
  ) async {
    final now = DateTime.now();
    final first = now.add(const Duration(minutes: 1));
    final newer = now.add(const Duration(minutes: 3));
    await tester.pumpWidget(_offer(deadline: first, onAccept: () {}));
    await tester.pumpWidget(_offer(deadline: newer, onAccept: () {}));
    await tester.pump(const Duration(minutes: 1));
    expect(find.text('Offer expired'), findsNothing);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNotNull);
    await tester.pump(const Duration(minutes: 2));
    expect(find.text('Offer expired'), findsOneWidget);
    // A refreshed offer can become available again without replacing the card.
    await tester.pumpWidget(_offer(
      deadline: DateTime.now().add(const Duration(minutes: 5)),
      onAccept: () {},
    ));
    expect(find.text('Offer expired'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('pending is not expiry and removing deadline cancels its timer', (
    tester,
  ) async {
    await tester.pumpWidget(_offer(
      deadline: DateTime.now().add(const Duration(minutes: 1)),
    ));
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull);
    expect(find.text('Offer expired'), findsNothing);
    await tester.pumpWidget(_offer(deadline: null));
    await tester.pump(const Duration(minutes: 2));
    expect(find.text('Offer expired'), findsNothing);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull);
  });

  testWidgets('already expired deadline blocks actions on first build', (
    tester,
  ) async {
    var actions = 0;
    await tester.pumpWidget(_offer(
      deadline: DateTime.utc(2000),
      onAccept: () => actions++,
      onDecline: () => actions++,
    ));
    expect(find.text('Offer expired'), findsOneWidget);
    await tester.tap(find.text('Accept this offer'));
    await tester.tap(find.text('Decline with reason'), warnIfMissed: false);
    expect(actions, 0);
  });

  testWidgets('disposing a live offer cancels its deadline', (tester) async {
    await tester.pumpWidget(_offer(
      deadline: DateTime.now().add(const Duration(minutes: 1)),
      onAccept: () {},
    ));
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(minutes: 2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('deadline uses a compact local time and includes another day', (
    tester,
  ) async {
    String same = '', other = '';
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            same = driverOfferExpiryLabel(
              context,
              thai: true,
              expiresAt: DateTime(2026, 10, 21, 12, 34).toIso8601String(),
              now: DateTime(2026, 10, 21, 10),
            );
            other = driverOfferExpiryLabel(
              context,
              thai: false,
              expiresAt: DateTime(2026, 10, 22, 12, 34).toIso8601String(),
              now: DateTime(2026, 10, 21, 10),
            );
            return const SizedBox.shrink();
          },
        ),
      ),
    );
    expect(same, 'งานใหม่ · รับก่อน 12:34');
    expect(other, contains('22'));
    expect(other, contains('12:34'));
    expect(other, isNot(contains('T12:34')));
  });
  testWidgets('deadline stops advertising an offer at the expiry instant', (
    tester,
  ) async {
    final now = DateTime.utc(2026, 10, 23, 5);
    final labels = <String>[];
    await tester.pumpWidget(MaterialApp(home: Builder(builder: (context) {
      for (final thai in [true, false]) {
        for (final delta in [-1, 0, 1]) {
          labels.add(driverOfferExpiryLabel(
            context,
            thai: thai,
            expiresAt: now.add(Duration(seconds: delta)).toIso8601String(),
            now: now,
          ));
        }
      }
      return const SizedBox.shrink();
    })));
    expect(labels.take(2), everyElement('ข้อเสนองานหมดอายุแล้ว'));
    expect(labels[2], startsWith('งานใหม่'));
    expect(labels.skip(3).take(2), everyElement('Offer expired'));
    expect(labels[5], startsWith('New offer'));
  });
  for (final thai in [true, false]) {
    testWidgets(
      'offer preserves quote and guarded controls with large text $thai',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(320, 740));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        var accepted = 0;
        Future<void> mount(bool enabled) => tester.pumpWidget(
          MaterialApp(
            theme: BitPosTheme.light(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: const TextScaler.linear(1.5)),
              child: child!,
            ),
            home: Scaffold(
              body: SingleChildScrollView(
                child: DriverFoodOfferCard(
                  thai: thai,
                  expiryLabel: '2026-10-21T12:00:00.000Z',
                  earning: '1234567890.123456 USDG',
                  pickup: '13.7450000, 100.5350000',
                  onAccept: enabled ? () => accepted++ : null,
                  declineAction: TextButton(
                    onPressed: enabled ? () {} : null,
                    child: const Text('Decline with reason'),
                  ),
                ),
              ),
            ),
          ),
        );
        await mount(true);
        expect(find.text('1234567890.123456 USDG'), findsOneWidget);
        expect(
          find.text(thai ? 'ยังไม่ใช่รายได้ที่ชำระแล้ว' : 'Not a paid earning'),
          findsOneWidget,
        );
        final accept = find.byType(FilledButton);
        await tester.scrollUntilVisible(accept, 200);
        await tester.tap(accept);
        expect(accepted, 1);
        await mount(false);
        expect(tester.widget<FilledButton>(accept).onPressed, isNull);
        expect(
          tester.widget<TextButton>(find.byType(TextButton)).onPressed,
          isNull,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }
}
