import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_customer/favourites_sheet.dart';
import 'package:bitpos_customer/food_review_page.dart';
import 'package:bitpos_customer/help_page.dart';
import 'package:bitpos_customer/presentation/customer_navigation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/food_chat_page.dart';

import 'favourites_sheet_test.dart' as fav;
import 'food_history_test.dart' as history;
import 'food_review_page_test.dart' as review;
import 'food_root_navigation_test.dart' show RootChatApi;
import 'help_support_owner_test.dart' as help;

Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  const directory = String.fromEnvironment('BITPOS_DS10_CAPTURE_DIR');
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
  await review.loadReviewFonts();
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
    final l = thai ? 'TH' : 'EN';
    testWidgets('U28 390 $l visual', (tester) async {
      final api = fav.FavouriteApi();
      addTearDown(api.close);
      final key = await _mount(
        tester,
        FavouritesSheet(
          api: api,
          firstPage: fav.availableBranches(),
          thai: thai,
          onAuthenticationRequired: () {},
          onNavigate: (_) {},
        ),
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U28-$l');
    });
    testWidgets('U29 390 $l visual', (tester) async {
      final api = RootChatApi();
      addTearDown(api.close);
      final key = await _mount(
        tester,
        FoodChatPageView(
          api: api,
          assignmentId: history.id(2),
          thai: thai,
          rider: false,
          bottomNavigationBar: SafeArea(
            top: false,
            child: CustomerNavigation(
              thai: thai,
              selectedIndex: 1,
              onSelected: (_) {},
            ),
          ),
        ),
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U29-$l');
    });
    testWidgets('U30 390 $l visual', (tester) async {
      final api = help.HelpFixtureApi();
      addTearDown(api.close);
      final owner = ValueNotifier(true);
      addTearDown(owner.dispose);
      final key = await _mount(
        tester,
        HelpPage(
          api: api,
          owner: owner,
          thai: thai,
          onAuthenticationRequired: () {},
        ),
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U30-$l');
    });
    testWidgets('U31 390 $l visual', (tester) async {
      final api = review.ReviewApi();
      addTearDown(api.close);
      final key = await _mount(
        tester,
        FoodReviewPage(
          api: api,
          orderId: review.order,
          thai: thai,
          owner: null,
          onAuthenticationRequired: () {},
        ),
      );
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U31-$l');
    });
  }
}
