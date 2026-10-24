import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/main.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('actual owned closed driver history and logout privacy', (
    tester,
  ) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
      throw StateError('Fixture required');
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
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: DriverSessionPage(api: api),
      ),
    );
    for (var i = 0; i < 100 && find.text('English').evaluate().isEmpty; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    await tester.pump();
    await tester.tap(find.text('English'));
    await tester.pump();
    for (
      var i = 0;
      i < 100 && find.text('Location sharing').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
    debugPrint(
      'DRIVER_ROOT_LABELS ${tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' | ')}',
    );
    expect(find.text('Location sharing'), findsOneWidget);
    debugPrint('BITPOS_DRIVER_ACCOUNT_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.scrollUntilVisible(
      find.text('Help and safety'),
      150,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Help and safety'));
    await tester.pumpAndSettle();
    debugPrint('BITPOS_DRIVER_HELP_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.scrollUntilVisible(
      find.text('Earnings and payouts'),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Earnings and payouts'));
    await tester.pumpAndSettle();
    final enquiry = "Synthetic rider support enquiry ${session['sessionId']}";
    await tester.enterText(find.byType(TextField).last, enquiry);
    await tester.ensureVisible(find.text('Send request / message'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send request / message'));
    await tester.pump();
    bool submitted = false;
    for (var i = 0; i < 100 && !submitted; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
      final cases = await tester.runAsync(() => api.supportCases());
      submitted =
          cases?.items.any((item) => item.subject == 'Earnings and payouts') ??
          false;
    }
    expect(submitted, true);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.tap(find.text('History'));
    await tester.pump();
    for (
      var i = 0;
      i < 100 && find.textContaining('Quoted delivery fee:').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
    debugPrint(
      'HISTORY_VISIBLE_LABELS ${tester.widgetList<Text>(find.byType(Text)).map((t) => t.data ?? '').join(' | ')}',
    );
    expect(find.textContaining('Quoted delivery fee:'), findsWidgets);
    debugPrint('BITPOS_DRIVER_HISTORY_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.tap(find.text('Earnings'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    for (
      var i = 0;
      i < 100 && find.text('Your earnings').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(find.text('Your earnings'), findsOneWidget);
    expect(find.textContaining('Quoted delivery fee:'), findsNothing);
    debugPrint('BITPOS_DRIVER_EARNINGS_TAB_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.tap(find.text('Account'));
    await tester.pumpAndSettle();
    expect(find.text('Your earnings'), findsNothing);
    expect(find.text('Food driver sign in'), findsNothing);
    final work = await tester.runAsync(() => api.foodDriverWork());
    expect(work!.assignment, isNull);
    expect(work.offers, isEmpty);
    await tester.tap(find.text('Work'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    for (
      var i = 0;
      i < 100 &&
          find
              .byKey(const ValueKey('food-private-idle-panel'))
              .evaluate()
              .isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    await tester.pump();
    expect(
      find.byKey(const ValueKey('food-private-idle-panel')),
      findsOneWidget,
    );
    for (
      var i = 0;
      i < 100 &&
          find.text('Availability unconfirmed. Refresh.').evaluate().isNotEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    expect(find.text('Availability unconfirmed. Refresh.'), findsNothing);
    expect(find.textContaining('according to server'), findsOneWidget);
    debugPrint('BITPOS_DRIVER_WORK_TAB_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.tap(find.text('History'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    for (
      var i = 0;
      i < 100 && find.textContaining('Quoted delivery fee:').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(find.textContaining('Quoted delivery fee:'), findsWidgets);
    await tester.runAsync(() => api.logout());
    await tester.pumpAndSettle();
    expect(find.text('Food driver sign in'), findsOneWidget);
    expect(find.textContaining('Quoted delivery fee:'), findsNothing);
  });
}
