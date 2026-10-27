import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_customer/account_page.dart';
import 'package:bitpos_customer/presentation/feature_preview_pages.dart';
import 'package:bitpos_customer/presentation/ride_preview_pages.dart';
import 'package:bitpos_customer/rewards_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'account_reload_test.dart' show ReloadAccountApi;
import 'food_review_page_test.dart' show loadReviewFonts;

Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  const directory = String.fromEnvironment('BITPOS_DS12_CAPTURE_DIR');
  if (directory.isEmpty) return;
  Directory(directory).createSync(recursive: true);
  await tester.pump();
  await tester.runAsync(() async {
    final image =
        await (key.currentContext!.findRenderObject() as RenderRepaintBoundary)
            .toImage(pixelRatio: 1);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    await File('$directory/$name.png').writeAsBytes(data!.buffer.asUint8List());
    image.dispose();
  });
}

Future<GlobalKey> _mount(WidgetTester tester, Widget child) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = const Size(390, 844);
  addTearDown(tester.view.reset);
  await loadReviewFonts();
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
  testWidgets(
    'account opens preview hub and every route walks back without mutation',
    (tester) async {
      final api = ReloadAccountApi(), owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      await _mount(
        tester,
        AccountPage(
          api: api,
          owner: owner,
          thai: false,
          onNavigate: (_) {},
          onAuthenticationRequired: () {},
        ),
      );
      await tester.ensureVisible(find.text('Coming features'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Coming features'));
      await tester.pumpAndSettle();
      for (final (entry, marker) in [
        ('Your coupons', 'Apply coupon'),
        ('Schedule an order', 'Confirm time'),
        ('Order together', 'Share group link'),
        ('Several merchants', 'Review orders per merchant'),
      ]) {
        await tester.ensureVisible(find.text(entry).first);
        await tester.tap(find.text(entry).first);
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('preview-sample-badge')),
          findsOneWidget,
        );
        final cta = tester.widget<FilledButton>(
          find.widgetWithText(FilledButton, marker),
        );
        expect(
          cta.onPressed,
          isNull,
          reason: '$entry primary action must stay disabled',
        );
        await tester.pageBack();
        await tester.pumpAndSettle();
      }
      await tester.ensureVisible(find.text('BitPOS Rewards'));
      await tester.tap(find.text('BitPOS Rewards'));
      await tester.pumpAndSettle();
      expect(
        find.byType(RewardsPage),
        findsOneWidget,
        reason: 'rewards is a real page now, not the sample screen',
      );
      expect(find.byKey(const ValueKey('preview-sample-badge')), findsNothing);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Rides with BitPOS'));
      await tester.tap(find.text('Rides with BitPOS'));
      await tester.pumpAndSettle();
      for (final marker in [
        'Find a ride',
        'Confirm ride',
        'Cancel search',
        'Safety and trip sharing',
      ]) {
        expect(find.byKey(const ValueKey('ride-sample-badge')), findsOneWidget);
        expect(
          tester
              .widget<FilledButton>(find.widgetWithText(FilledButton, marker))
              .onPressed,
          isNull,
        );
        await tester.drag(find.byType(ListView).last, const Offset(0, -400));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('ride-next-sample')));
        await tester.pumpAndSettle();
      }
      expect(find.text('You have arrived'), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Submit review'),
            )
            .onPressed,
        isNull,
      );
      expect(tester.takeException(), isNull);
    },
  );

  for (final thai in [true, false]) {
    final l = thai ? 'TH' : 'EN';
    final pages = <String, Widget>{
      'U26': CouponsPreviewPage(thai: thai),
      'U27': RewardsPreviewPage(thai: thai),
      'U35': SchedulePreviewPage(thai: thai),
      'U36': GroupOrderPreviewPage(thai: thai),
      'U37': MultiMerchantPreviewPage(thai: thai),
      'U39': RideHomePreviewPage(thai: thai),
      'U40': RideQuotePreviewPage(thai: thai),
      'U41': RideMatchingPreviewPage(thai: thai),
      'U42': RideTripPreviewPage(thai: thai),
      'U43': RideArrivedPreviewPage(thai: thai),
    };
    for (final e in pages.entries) {
      testWidgets('${e.key} 390 $l visual', (tester) async {
        final key = await _mount(tester, e.value);
        expect(tester.takeException(), isNull);
        await _capture(tester, key, '${e.key}-$l');
      });
    }
  }
}
