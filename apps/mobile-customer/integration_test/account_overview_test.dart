import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/account_page.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('actual account overview profile mutation addresses and logout', (
    tester,
  ) async {
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
        ),
        owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await api.restore();
    expect(api.signedIn, true);
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: AccountPage(
          api: api,
          owner: owner,
          thai: false,
          onNavigate: (_) {},
          onSignOut: () => api.logout(allDevices: true),
          onAuthenticationRequired: () =>
              throw StateError('Unexpected retired session'),
        ),
      ),
    );
    for (
      var i = 0;
      i < 100 && find.text('Account settings').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
    await tester.tap(find.text('Account settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Profile and language'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextFormField, 'Display name'),
      'Account AVD updated',
    );
    await tester.ensureVisible(find.text('Save profile'));
    await tester.tap(find.text('Save profile'));
    await tester.pump();
    bool saved = false;
    for (var i = 0; i < 80 && !saved; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
      final profile = await tester.runAsync(() => api.profile());
      saved = profile?.displayName == 'Account AVD updated';
    }
    expect(saved, true);
    await tester.pumpAndSettle();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Back to settings'));
    await tester.pumpAndSettle();
    debugPrint('BITPOS_ACCOUNT_SETTINGS_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.tap(find.byTooltip('Back to account'));
    await tester.pumpAndSettle();
    expect(find.text('Account AVD updated'), findsOneWidget);
    debugPrint('BITPOS_ACCOUNT_OVERVIEW_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.tap(find.text('My addresses'));
    await tester.pumpAndSettle();
    expect(find.text('No saved addresses yet.'), findsOneWidget);
    await tester.tap(find.byTooltip('Back to account'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Account settings'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Signed-in sessions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Signed-in sessions'));
    await tester.pump();
    for (
      var i = 0;
      i < 80 && find.text('Other session').evaluate().isEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    await tester.pumpAndSettle();
    expect(find.text('Current session'), findsOneWidget);
    expect(find.text('Other session'), findsOneWidget);
    debugPrint('BITPOS_ACCOUNT_SESSIONS_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.tap(find.text('Revoke session'));
    await tester.pump();
    for (
      var i = 0;
      i < 80 && find.text('Other session').evaluate().isNotEmpty;
      i++
    ) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    expect(find.text('Other session'), findsNothing);
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Privacy and notifications'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Privacy and notifications'));
    await tester.pumpAndSettle();
    debugPrint('BITPOS_ACCOUNT_PRIVACY_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.scrollUntilVisible(
      find.text('Request a data copy'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request a data copy'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField).last,
      'Please review this synthetic account data copy request',
    );
    await tester.ensureVisible(find.text('Send request / message'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Send request / message'));
    await tester.pump();
    bool requested = false;
    for (var i = 0; i < 80 && !requested; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
      final cases = await tester.runAsync(() => api.supportCases());
      requested =
          cases?.items.any(
            (item) => item.subject == 'Account data copy request',
          ) ??
          false;
    }
    expect(requested, true);
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Sign out all devices'),
      200,
      scrollable: find.byType(Scrollable).last,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign out all devices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(api.signedIn, true);
    await tester.tap(find.text('Sign out all devices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm sign out'));
    await tester.pump();
    for (var i = 0; i < 80 && api.signedIn; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
    }
    debugPrint('BITPOS_ACCOUNT_SETTINGS_SIGNOUT_COMPLETED');
    expect(api.signedIn, false);
    binding.reportData = {
      'status': 'PASS_ACTUAL_ACCOUNT_OVERVIEW_PROFILE_ADDRESSES_LOGOUT',
      'physicalTesting': 'deferred_by_user_2026-10-16',
    };
  });
}
