import 'package:bitpos_customer/account_privacy_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'help_support_owner_test.dart' show HelpFixtureApi;

class _Api extends HelpFixtureApi {
  int erased = 0;
  Object? failure;
  @override
  Future<MobileAccountErased> eraseAccountData() async {
    if (failure != null) throw failure!;
    erased++;
    return MobileAccountErased.fromJson({
      'erasedAt': '2026-10-27T00:00:00Z',
      'addressesBlanked': 1,
      'favouritesDeleted': 0,
    });
  }
}

Future<void> _open(
  WidgetTester tester,
  _Api api,
  ValueNotifier<bool> owner,
  VoidCallback onAuth,
) async {
  tester.view.physicalSize = const Size(390, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: AccountPrivacyPage(
        api: api,
        owner: owner,
        thai: false,
        onAuthenticationRequired: onAuth,
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.ensureVisible(
    find.byKey(const ValueKey('privacy-erase-account')),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'erase needs an explicit confirmation, says what is kept, then signs out',
    (tester) async {
      final api = _Api(), owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      var auth = 0;
      await _open(tester, api, owner, () => auth++);
      await tester.tap(find.byKey(const ValueKey('privacy-erase-account')));
      await tester.pumpAndSettle();
      expect(
        find.textContaining(
          'Orders, payments, refunds and support cases are kept',
        ),
        findsOneWidget,
      );
      expect(api.erased, 0, reason: 'opening the dialog changes nothing');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(api.erased, 0);
      expect(auth, 0);
      await tester.tap(find.byKey(const ValueKey('privacy-erase-account')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('erase-confirm')));
      await tester.pumpAndSettle();
      expect(api.erased, 1);
      expect(auth, 1, reason: 'a successful erase signs the app out');
    },
  );
  testWidgets(
    'open orders and failures are explained and nothing is claimed erased',
    (tester) async {
      final api = _Api()
            ..failure = const MobileApiException(
              'ACCOUNT_HAS_OPEN_ORDERS',
              409,
            ),
          owner = ValueNotifier(true);
      addTearDown(api.close);
      addTearDown(owner.dispose);
      var auth = 0;
      await _open(tester, api, owner, () => auth++);
      await tester.tap(find.byKey(const ValueKey('privacy-erase-account')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('erase-confirm')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Cannot erase yet'), findsOneWidget);
      expect(auth, 0);
      api.failure = const MobileApiException('RESPONSE_UNAVAILABLE', 503);
      await tester.tap(find.byKey(const ValueKey('privacy-erase-account')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('erase-confirm')));
      await tester.pumpAndSettle();
      expect(find.textContaining('Nothing was changed'), findsOneWidget);
      expect(auth, 0);
    },
  );
}
