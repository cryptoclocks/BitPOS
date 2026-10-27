import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_customer/group_cart_page.dart';

// Explicit local E2E: storage holds a synthetic account; every group call is real HTTP + SQL.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('group order through the real screen', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE'))
      throw StateError('Local fixture required');
    const stage = String.fromEnvironment('BITPOS_TEST_GROUP_STAGE');
    const token = String.fromEnvironment('BITPOS_TEST_GROUP_TOKEN');
    const groupId = String.fromEnvironment('BITPOS_TEST_GROUP_ID');
    const branchName = String.fromEnvironment('BITPOS_TEST_GROUP_BRANCH');
    expect([
      'OWNER_CREATE',
      'MEMBER',
      'OWNER_LOCK',
      'MEMBER_ORDER',
    ], contains(stage));
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': utf8.decode(
        base64Decode(
          const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'),
        ),
      ),
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
    });
    final api = MobileApi(
      base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
      fixture: true,
    );
    addTearDown(api.close);
    await tester.runAsync(api.restore);
    expect(api.signedIn, isTrue);
    tester.view.physicalSize = const Size(900, 3200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        theme: BitPosTheme.light(),
        home: GroupCartPage(
          gateway: GroupCartGateway.fromApi(api),
          thai: false,
        ),
      ),
    );
    Future<void> wait(Finder finder) async {
      for (var n = 0; n < 300 && finder.evaluate().isEmpty; n++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 100)),
        );
      }
      expect(
        finder,
        findsWidgets,
        reason:
            'Visible UI: ${tester.widgetList<Text>(find.byType(Text)).map((t) => t.data).whereType<String>().take(30).join(' | ')}',
      );
    }

    Future<void> tap(Finder finder) async {
      await wait(finder);
      await tester.ensureVisible(finder.first);
      await tester.tap(finder.first);
      await tester.pump();
    }

    Future<void> addItem(int times) async {
      await tap(find.byKey(const ValueKey('group-load-branches')));
      await tap(find.text(branchName));
      await wait(find.textContaining('Group AVD latte'));
      for (var i = 0; i < times; i++) {
        final plus = find.byWidgetPredicate(
          (w) =>
              w.key is ValueKey<String> &&
              (w.key as ValueKey<String>).value.startsWith('group-plus.'),
        );
        await tap(plus);
        await tester.pumpAndSettle();
      }
    }

    await wait(find.byKey(const ValueKey('group-create')));
    if (stage == 'OWNER_CREATE') {
      await tap(find.byKey(const ValueKey('group-create')));
      await wait(find.byKey(const ValueKey('group-state')));
      await tap(find.byKey(const ValueKey('group-invite')));
      await wait(find.byKey(const ValueKey('group-token')));
      debugPrint(
        'BITPOS_GROUP_TOKEN:${tester.widget<SelectableText>(find.byKey(const ValueKey('group-token'))).data}',
      );
      await addItem(1);
      await wait(find.textContaining('You · Group AVD latte × 1'));
      final id = (await tester.runAsync(
        () async => (await api.groups()).groups.first.id,
      ))!;
      debugPrint('BITPOS_GROUP_ID:$id');
    } else if (stage == 'MEMBER') {
      await tester.enterText(find.byKey(const ValueKey('group-code')), token);
      await tap(find.byKey(const ValueKey('group-join')));
      await wait(find.byKey(const ValueKey('group-state')));
      expect(
        find.byKey(const ValueKey('group-lock')),
        findsNothing,
        reason: 'only the owner locks',
      );
      await addItem(2);
      await wait(find.textContaining('You · Group AVD latte × 2'));
      expect(
        find.textContaining('Member · '),
        findsOneWidget,
        reason: "the owner's line is visible to the member",
      );
      debugPrint('BITPOS_GROUP_MEMBER_DONE');
    } else if (stage == 'MEMBER_ORDER') {
      await tap(find.byKey(ValueKey('group-open.$groupId')));
      await wait(find.byKey(const ValueKey('group-locked')));
      final delivery = find.byWidgetPredicate(
        (widget) =>
            widget.key is ValueKey<String> &&
            (widget.key as ValueKey<String>).value.startsWith(
              'group-delivery.',
            ),
      );
      await tap(delivery);
      final address = find.byWidgetPredicate(
        (widget) =>
            widget.key is ValueKey<String> &&
            (widget.key as ValueKey<String>).value.startsWith('group-address.'),
      );
      await tap(address);
      await tap(find.widgetWithText(OutlinedButton, 'Get my price'));
      await wait(find.text('6.60 USD'));
      expect(find.textContaining('takes no payment'), findsOneWidget);
      await tap(find.widgetWithText(FilledButton, 'Place delivery order'));
      await wait(find.textContaining('Order placed'));
      debugPrint('BITPOS_GROUP_MEMBER_ORDERED');
    } else {
      await tap(find.byKey(ValueKey('group-open.$groupId')));
      await wait(find.byKey(const ValueKey('group-lock')));
      await tap(find.byKey(const ValueKey('group-lock')));
      await wait(find.byKey(const ValueKey('group-locked')));
      expect(find.byKey(const ValueKey('group-lock')), findsNothing);
      debugPrint('BITPOS_GROUP_LOCKED');
    }
    expect(tester.takeException(), isNull);
  });
}
