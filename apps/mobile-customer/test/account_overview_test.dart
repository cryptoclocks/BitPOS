import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/account_page.dart';

import 'account_reload_test.dart' show ReloadAccountApi;

class RefreshAccountApi extends ReloadAccountApi {
  String name = 'Before refresh';
  int reads = 0;
  @override
  Future<MobileProfile> profile() async {
    reads++;
    return MobileProfile(
      id: '00000000-0000-4000-8000-000000000001',
      displayName: name,
      locale: 'en',
      version: '1',
    );
  }
}

void main() {
  testWidgets('account overview opens isolated settings and address sections', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = ReloadAccountApi(), owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AccountPage(
          api: api,
          owner: owner,
          thai: false,
          onNavigate: (_) {},
          onAuthenticationRequired: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Fixture'), findsOneWidget);
    expect(find.byType(TextFormField), findsNothing);
    expect(
      tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
      3,
    );
    await tester.tap(find.text('Account settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Profile and language'));
    await tester.pumpAndSettle();
    expect(find.text('Display name'), findsOneWidget);
    expect(find.text('Home v1'), findsNothing);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Account settings'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Your account'), findsOneWidget);
    await tester.tap(find.text('My addresses'));
    await tester.pumpAndSettle();
    expect(find.text('Home v1'), findsOneWidget);
    expect(find.text('Display name'), findsNothing);
    await tester.ensureVisible(find.text('Edit'));
    await tester.tap(find.text('Edit'));
    await tester.pumpAndSettle();
    expect(find.text('Edit address'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('U33 account overview uses a readable desktop grid', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = ReloadAccountApi(), owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AccountPage(
          api: api,
          owner: owner,
          thai: false,
          onNavigate: (_) {},
          onAuthenticationRequired: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    final identity = tester.getRect(
      find.byKey(const ValueKey('account-identity-card')),
    );
    final addresses = tester.getRect(
      find.byKey(const ValueKey('account-addresses-tile')),
    );
    final settings = tester.getRect(
      find.byKey(const ValueKey('account-settings-tile')),
    );
    expect(identity.width, closeTo(852, 0.01));
    expect(addresses.left, closeTo(identity.left, 0.01));
    expect(settings.left, greaterThan(addresses.right));
    expect(find.text('Your BitPOS account'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('U33 and U34 keep Thai account and privacy labels', (
    tester,
  ) async {
    final api = ReloadAccountApi(), owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AccountPage(
          api: api,
          owner: owner,
          thai: true,
          onNavigate: (_) {},
          onAuthenticationRequired: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('บัญชีของคุณ'), findsOneWidget);
    expect(find.text('บัญชี BitPOS ของคุณ'), findsOneWidget);
    await tester.tap(find.text('ตั้งค่าบัญชี'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('ความเป็นส่วนตัวและการแจ้งเตือน'));
    await tester.pumpAndSettle();
    expect(find.text('ความเป็นส่วนตัว'), findsOneWidget);
    expect(find.text('คำขอข้อมูล'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('settings confirmation cancels or signs out once', (
    tester,
  ) async {
    final api = ReloadAccountApi(), owner = ValueNotifier(true);
    int signouts = 0;
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AccountPage(
          api: api,
          owner: owner,
          thai: false,
          onNavigate: (_) {},
          notificationSettings: const Text('Bound notification controls'),
          onSignOut: () async {
            signouts++;
          },
          onAuthenticationRequired: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Account settings'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Privacy and notifications'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Bound notification controls'));
    expect(find.text('Bound notification controls'), findsOneWidget);
    await tester.tap(find.byTooltip('Back to account settings'));
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
    expect(signouts, 0);
    await tester.tap(find.text('Sign out all devices'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Confirm sign out'));
    await tester.pumpAndSettle();
    expect(signouts, 1);
  });
  testWidgets(
    'owner loss removes settings signout dialog and prevents stale action',
    (tester) async {
      final api = ReloadAccountApi(), owner = ValueNotifier(true);
      int signouts = 0;
      addTearDown(api.close);
      addTearDown(owner.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => AccountPage(
                      api: api,
                      owner: owner,
                      thai: false,
                      onNavigate: (_) {},
                      onSignOut: () async {
                        signouts++;
                      },
                      onAuthenticationRequired: () {},
                    ),
                  ),
                ),
                child: const Text('Open account'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open account'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Account settings'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Sign out all devices'),
        200,
        scrollable: find.byType(Scrollable).last,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sign out all devices'));
      await tester.pumpAndSettle();
      expect(find.text('Confirm sign out'), findsOneWidget);
      owner.value = false;
      await tester.pumpAndSettle();
      expect(find.text('Confirm sign out'), findsNothing);
      expect(find.text('Account settings'), findsNothing);
      expect(find.text('Open account'), findsOneWidget);
      expect(signouts, 0);
    },
  );
  testWidgets(
    'overview pull refresh reads latest profile without a diagnostic footer',
    (tester) async {
      final api = RefreshAccountApi(), owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: AccountPage(
            api: api,
            owner: owner,
            thai: false,
            onNavigate: (_) {},
            onAuthenticationRequired: () {},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Before refresh'), findsOneWidget);
      expect(find.text('Reload server details'), findsNothing);
      api.name = 'After refresh';
      await tester.drag(find.byType(ListView), const Offset(0, 400));
      await tester.pumpAndSettle();
      expect(find.text('After refresh'), findsOneWidget);
      expect(api.reads, 2);
      await tester.tap(find.text('Account settings'));
      await tester.pumpAndSettle();
      expect(find.byType(TextFormField), findsNothing);
      expect(find.text('Reload server details'), findsNothing);
    },
  );
}
