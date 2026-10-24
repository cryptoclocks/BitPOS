import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/favourites_sheet.dart';
import 'package:bitpos_customer/presentation/favourite_branch_card.dart';
import 'package:bitpos_customer/main.dart';

import '../test/notification_owner_test.dart' show PushNative;

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('actual local owned favourite save list remove', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
      throw StateError('Local fixture required');
    }
    final session = jsonDecode(
      utf8.decode(
        base64Decode(
          const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'),
        ),
      ),
    );
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': jsonEncode(session),
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
    });
    final api = MobileApi(
      base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
      fixture: true,
    );
    addTearDown(api.close);
    await api.restore();
    expect(api.signedIn, true);
    const branch = String.fromEnvironment('BITPOS_TEST_BRANCH_ID');
    await tester.runAsync(() => api.setFavourite(branch, true));
    final first = (await tester.runAsync(() => api.favourites()))!;
    expect(first.items.any((x) => x.branchId == branch), true);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: CustomerSessionPage(api: api, pushNative: PushNative()),
      ),
    );
    Future<void> ready(Finder finder) async {
      final deadline = DateTime.now().add(const Duration(seconds: 45));
      while (finder.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
      }
      expect(finder, findsWidgets);
    }

    await ready(find.text('ร้านโปรด'));
    await tester.tap(find.text('ร้านโปรด').last);
    await ready(find.byType(FavouritesSheet));
    await ready(find.text('ร้านโปรดทดสอบ AVD'));
    await tester.pumpAndSettle();
    expect(find.text('ร้านโปรดทดสอบ AVD'), findsOneWidget);
    Rect rect(Finder finder) => tester.getRect(finder);
    final search = rect(find.byType(TextField)),
        card = rect(find.byType(FavouriteBranchCard).first),
        navigation = rect(find.byType(NavigationBar));
    final geometry = {
      'viewportLogical': {
        'width': tester.view.physicalSize.width / tester.view.devicePixelRatio,
        'height':
            tester.view.physicalSize.height / tester.view.devicePixelRatio,
      },
      'viewPaddingLogical': {
        'top': tester.view.viewPadding.top / tester.view.devicePixelRatio,
        'bottom': tester.view.viewPadding.bottom / tester.view.devicePixelRatio,
      },
      'mediaPaddingLogical': {
        'top': MediaQuery.of(tester.element(find.byType(FavouritesSheet)))
            .padding
            .top,
        'bottom': MediaQuery.of(tester.element(find.byType(FavouritesSheet)))
            .padding
            .bottom,
      },
      'search': {
        'left': search.left,
        'top': search.top,
        'width': search.width,
        'height': search.height,
      },
      'firstCard': {
        'left': card.left,
        'top': card.top,
        'width': card.width,
        'height': card.height,
      },
      'navigation': {
        'left': navigation.left,
        'top': navigation.top,
        'width': navigation.width,
        'height': navigation.height,
      },
    };
    debugPrint('BITPOS_U28_GEOMETRY:${jsonEncode(geometry)}');
    debugPrint('BITPOS_FAVOURITES_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.tap(find.byTooltip('นำออกจากร้านโปรด'));
    await tester.pump();
    for (
      var i = 0;
      i < 80 && find.text('ร้านโปรดทดสอบ AVD').evaluate().isNotEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    expect(find.text('ร้านโปรดทดสอบ AVD'), findsNothing);
    expect(find.textContaining('ยังไม่มีร้านโปรด'), findsOneWidget);
    final last = (await tester.runAsync(() => api.favourites()))!;
    expect(last.items.any((x) => x.branchId == branch), false);
    await tester.runAsync(() => api.logout());
    binding.reportData = {
      'status': 'PASS_ACTUAL_AVD_FAVOURITES_SAVE_REMOVE',
      'physicalTesting': 'deferred_by_user_2026-10-16',
    };
  });
}
