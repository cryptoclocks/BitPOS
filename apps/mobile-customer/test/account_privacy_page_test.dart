import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/support_mutation.dart';
import 'package:bitpos_customer/account_privacy_page.dart';
import 'package:bitpos_customer/support_page.dart';

import 'help_support_owner_test.dart' show HelpFixtureApi;

void main() {
  for (final deletion in [false, true]) {
    testWidgets(
      'privacy ${deletion ? 'deletion' : 'copy'} creates review request not an erasure receipt',
      (tester) async {
        final api = HelpFixtureApi(), owner = ValueNotifier(true);
        addTearDown(api.close);
        addTearDown(owner.dispose);
        api.result.complete(MobileSupportCases(items: [], nextCursor: null));
        await tester.pumpWidget(
          MaterialApp(
            home: AccountPrivacyPage(
              api: api,
              owner: owner,
              thai: false,
              onAuthenticationRequired: () {},
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(
          find.textContaining('Submitting does not download or erase'),
          findsOneWidget,
        );
        final label = deletion
            ? 'Request data deletion'
            : 'Request a data copy';
        await tester.ensureVisible(find.text(label));
        await tester.pumpAndSettle();
        await tester.tap(find.text(label));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byType(TextField).last,
          'Please review my account data request',
        );
        await tester.ensureVisible(find.text('Send request / message'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Send request / message'));
        await tester.pumpAndSettle();
        final sent = api.submitted as CreateSupportMutation;
        expect(
          sent.command.subject,
          deletion
              ? 'Account data deletion request'
              : 'Account data copy request',
        );
        expect(sent.command.order, isNull);
      },
    );
  }
  testWidgets('U34 privacy reflows its truthful controls on desktop', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1280, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final api = HelpFixtureApi(), owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: AccountPrivacyPage(
          api: api,
          owner: owner,
          thai: false,
          onAuthenticationRequired: () {},
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Location and addresses'), findsOneWidget);
    expect(find.text('Data copy and deletion'), findsOneWidget);
    expect(find.text('Data requests'), findsOneWidget);
    expect(find.text('Request a data copy'), findsOneWidget);
    expect(
      find.textContaining('Submitting does not download or erase'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
  testWidgets('owner retirement removes privacy and its request form', (
    tester,
  ) async {
    final api = HelpFixtureApi(), owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => AccountPrivacyPage(
                    api: api,
                    owner: owner,
                    thai: false,
                    onAuthenticationRequired: () {},
                  ),
                ),
              ),
              child: const Text('Open privacy'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open privacy'));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Request a data copy'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Request a data copy'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    owner.value = false;
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 350));
    api.result.complete(MobileSupportCases(items: [], nextCursor: null));
    await tester.pump();
    expect(find.byType(SupportPage), findsNothing);
    expect(find.byType(AccountPrivacyPage), findsNothing);
    expect(find.text('Open privacy'), findsOneWidget);
  });
}
