import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_customer/account_page.dart';
import 'package:bitpos_customer/account_privacy_page.dart';
import 'package:bitpos_customer/account_sessions_page.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import 'account_reload_test.dart' show ReloadAccountApi;
import 'account_sessions_page_test.dart' show SessionsApi;
import 'food_review_page_test.dart' as review;
import 'help_support_owner_test.dart' show HelpFixtureApi;

Future<void> _capture(WidgetTester tester, GlobalKey key, String name) async {
  const directory = String.fromEnvironment('BITPOS_DS11_CAPTURE_DIR');
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
    testWidgets('U33 overview 390 $l', (tester) async {
      final api = ReloadAccountApi(), owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      final key = await _mount(tester, AccountPage(api: api, owner: owner, thai: thai, onNavigate: (_) {}, onAuthenticationRequired: () {}));
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U33-overview-$l');
    });
    testWidgets('U32 settings 390 $l', (tester) async {
      final api = ReloadAccountApi(), owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      final key = await _mount(tester, AccountPage(api: api, owner: owner, thai: thai, onNavigate: (_) {}, onAuthenticationRequired: () {}));
      await tester.tap(find.byType(InkWell).at(1));
      await tester.pumpAndSettle();
      await _capture(tester, key, 'U32-settings-$l');
    });
    testWidgets('U34 privacy 390 $l', (tester) async {
      final api = HelpFixtureApi(), owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      api.result.complete(MobileSupportCases(items: [], nextCursor: null));
      final key = await _mount(tester, AccountPrivacyPage(api: api, owner: owner, thai: thai, onAuthenticationRequired: () {}));
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U34-privacy-$l');
    });
    testWidgets('U33 sessions 390 $l', (tester) async {
      final api = SessionsApi(), owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      final key = await _mount(tester, AccountSessionsPage(api: api, owner: owner, thai: thai, onAuthenticationRequired: () {}));
      expect(tester.takeException(), isNull);
      await _capture(tester, key, 'U33-sessions-$l');
    });
  }
}
