import 'dart:core';

import 'package:bitpos_customer/loyalty_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

const _shop = '22222222-2222-4222-8222-222222222222';
Map<String, Object?> _tier(int slot, String en, int min) => {'slot': slot, 'nameTh': 'ระดับ$slot', 'nameEn': en, 'minPoints': min, 'mintAddress': null};
Map<String, Object?> _shopJson({
  int points = 35,
  bool consent = false,
  bool bound = false,
  Map<String, Object?>? badge,
  Map<String, Object?>? current,
  Map<String, Object?>? next,
  int? toNext,
}) => {
  'merchantId': _shop,
  'merchantName': 'Test Cafe',
  'configured': true,
  'currency': 'USD',
  'decimals': 2,
  'lifetimePoints': points,
  'current': current ?? _tier(1, 'Regular', 20),
  'next': next ?? _tier(2, 'Gold', 50),
  'pointsToNext': toNext ?? 15,
  'consentGranted': consent,
  'walletBound': bound,
  'walletAddress': bound ? '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin' : null,
  'badge': badge,
};

class _Api extends MobileApi {
  _Api() : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  List<Map<String, Object?>> shops = [_shopJson()];
  Object? loadFailure;
  int loads = 0, binds = 0;
  final consents = <bool>[];
  bool bindFailure = false;
  Object? consentFailure;
  @override
  Future<MobileLoyaltyOverview> loyalty() async {
    loads++;
    if (loadFailure != null) throw loadFailure!;
    return MobileLoyaltyOverview.fromJson({'generatedAt': '2026-10-31T00:00:00Z', 'shops': shops});
  }

  @override
  Future<MobileLoyaltyConsent> setLoyaltyConsent(MobileLoyaltyConsentRequest request) async {
    if (consentFailure != null) throw consentFailure!;
    consents.add(request.granted);
    shops = [_shopJson(consent: request.granted)];
    return MobileLoyaltyConsent.fromJson({'granted': request.granted});
  }

  @override
  Future<MobileLoyaltyBindCode> loyaltyBindCode() async {
    binds++;
    if (bindFailure) throw MobileApiException('INTERNAL_ERROR', 500, 'x');
    return MobileLoyaltyBindCode.fromJson({'code': 'ABCD-2345', 'expiresAt': '2026-10-31T00:10:00Z', 'bindUrl': 'https://pay.example/loyalty?code=ABCD-2345'});
  }
}

Widget _host(_Api api, {bool thai = false, bool reduce = false, VoidCallback? onAuth}) => MaterialApp(
  home: MediaQuery(
    data: MediaQueryData(disableAnimations: reduce, size: const Size(390, 900)),
    child: Scaffold(
      body: SingleChildScrollView(
        child: LoyaltySection(key: ValueKey(identityHashCode(api)), api: api, thai: thai, onAuthenticationRequired: onAuth ?? () {}, pollInterval: const Duration(milliseconds: 200)),
      ),
    ),
  ),
);

void main() {
  testWidgets('shows tier, animated points that settle on the server figure, and the distance to the next level (EN and TH)', (tester) async {
    final api = _Api();
    await tester.pumpWidget(_host(api));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byKey(const ValueKey('loyalty-section')), findsOneWidget);
    expect(find.text('Test Cafe'), findsOneWidget);
    expect(find.text('Regular'), findsOneWidget);
    expect(find.text('15 more points to Gold'), findsOneWidget);
    // mid-animation the count is below the target; once settled it equals the server value
    final mid = int.parse((tester.widget<Text>(find.byKey(const ValueKey('loyalty-points')))).data!);
    expect(mid, lessThan(35));
    await tester.pumpAndSettle();
    expect(find.text('35'), findsOneWidget);
    expect(find.text('No badge yet'), findsOneWidget);
    expect(find.byKey(const ValueKey('loyalty-footnote')), findsOneWidget);
    expect(find.textContaining('cannot be transferred'), findsOneWidget, reason: 'stated once for the section, not on every card');
    await tester.pumpWidget(_host(api, thai: true));
    await tester.pumpAndSettle();
    expect(find.text('อีก 15 แต้มถึงระดับ ระดับ2'), findsOneWidget);
  });

  testWidgets('reduced motion shows final values immediately', (tester) async {
    await tester.pumpWidget(_host(_Api(), reduce: true));
    await tester.pump();
    await tester.pump();
    expect(find.text('35'), findsOneWidget);
  });

  testWidgets('consent toggle calls the server, reloads, and reveals the wallet button; no wallet screen without consent', (tester) async {
    final api = _Api();
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('loyalty-connect-$_shop')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('loyalty-consent-$_shop')));
    await tester.pumpAndSettle();
    expect(api.consents, [true]);
    expect(api.loads, greaterThanOrEqualTo(2));
    expect(find.byKey(const ValueKey('loyalty-connect-$_shop')), findsOneWidget);
    expect(find.textContaining('Blockchain data is public'), findsNothing, reason: 'collapsed until asked');
    await tester.tap(find.byKey(const ValueKey('loyalty-details-$_shop')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Blockchain data is public'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('loyalty-consent-$_shop')));
    await tester.pumpAndSettle();
    expect(api.consents, [true, false]);
    expect(find.byKey(const ValueKey('loyalty-connect-$_shop')), findsNothing);
  });

  testWidgets('bind sheet shows the one-time code and closes with a success state once the wallet is proven', (tester) async {
    final api = _Api()..shops = [_shopJson(consent: true)];
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('loyalty-connect-$_shop')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600)); // sheet slides up; a spinner keeps animating so no pumpAndSettle
    expect(find.byKey(const ValueKey('bind-code-text')), findsOneWidget);
    expect(find.text('ABCD-2345'), findsOneWidget);
    expect(find.textContaining('not a payment'), findsOneWidget);
    expect(find.byKey(const ValueKey('bind-step-3')), findsOneWidget);
    expect(api.binds, 1);
    // the wallet signs on the web page -> next poll sees it bound
    api.shops = [_shopJson(consent: true, bound: true)];
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byKey(const ValueKey('bind-done')), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 1500));
    await tester.pump(const Duration(milliseconds: 600));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byKey(const ValueKey('bind-code-text')), findsNothing);
    expect(find.byKey(const ValueKey('loyalty-wallet-$_shop')), findsOneWidget);
    expect(find.textContaining('9xQe…VFin'), findsOneWidget);
  });

  testWidgets('bind code failure is announced with a retry; polling stops when the sheet closes', (tester) async {
    final api = _Api()..shops = [_shopJson(consent: true)]..bindFailure = true;
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('loyalty-connect-$_shop')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    expect(find.byKey(const ValueKey('bind-error')), findsOneWidget);
    api.bindFailure = false;
    await tester.tap(find.text('Try again'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('ABCD-2345'), findsOneWidget);
    await tester.tapAt(const Offset(10, 10)); // dismiss the sheet
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 600));
    final before = api.loads;
    await tester.pump(const Duration(seconds: 2));
    expect(api.loads, before, reason: 'no polling after the sheet is closed');
  });

  testWidgets('badge states are worded honestly: issuing, held, returned', (tester) async {
    Map<String, Object?> badge(String status) => {'tierSlot': 1, 'status': status, 'signature': null, 'mintAddress': '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 'wallet': '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'};
    final api = _Api();
    for (final (status, text) in [('PENDING', 'Sending your badge…'), ('CONFIRMED', 'Held in your wallet (devnet)'), ('REVOKED', 'Badge returned')]) {
      api.shops = [_shopJson(consent: true, bound: true, badge: badge(status))];
      await tester.pumpWidget(_host(api));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(find.text(text), findsOneWidget, reason: status);
      await tester.pumpWidget(const SizedBox());
    }
  });

  testWidgets('a held badge is shown as a collectible card that opens large on tap (falls back to a medal if the art cannot load)', (tester) async {
    final api = _Api()..shops = [_shopJson(consent: true, bound: true, badge: {'tierSlot': 2, 'status': 'CONFIRMED', 'signature': null, 'mintAddress': '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 'wallet': '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'})];
    await tester.pumpWidget(_host(api));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 900));
    expect(find.byKey(const ValueKey('loyalty-card-$_shop')), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('loyalty-card-$_shop')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const ValueKey('loyalty-card-dialog')), findsOneWidget);
    await tester.tapAt(const Offset(5, 5));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.byKey(const ValueKey('loyalty-card-dialog')), findsNothing);
    final locked = _Api()..shops = [_shopJson()];
    await tester.pumpWidget(_host(locked));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byKey(const ValueKey('loyalty-card-$_shop')), findsNothing, reason: 'no card before a badge is held');
  });

  testWidgets('top level, empty, outage and auth failure behave quietly', (tester) async {
    final api = _Api()..shops = [_shopJson(points: 80, current: _tier(2, 'Gold', 50), next: null, toNext: null)];
    // next == null needs the nullable fields set explicitly
    api.shops = [
      {..._shopJson(points: 80, current: _tier(2, 'Gold', 50)), 'next': null, 'pointsToNext': null},
    ];
    await tester.pumpWidget(_host(api));
    await tester.pumpAndSettle();
    expect(find.text('You are at the top level'), findsOneWidget);

    final empty = _Api()..shops = [];
    await tester.pumpWidget(_host(empty));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('loyalty-section')), findsNothing);

    final down = _Api()..loadFailure = MobileApiException('INTERNAL_ERROR', 500, 'x');
    await tester.pumpWidget(_host(down));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('loyalty-error')), findsOneWidget);

    var auth = 0;
    final out = _Api()..loadFailure = MobileApiException('AUTH_REQUIRED', 401, 'x');
    await tester.pumpWidget(_host(out, onAuth: () => auth++));
    await tester.pumpAndSettle();
    expect(auth, 0, reason: 'a passive load leaves sign-out to the page');
    expect(find.byKey(const ValueKey('loyalty-error')), findsNothing);
    // a user action that is refused for auth does delegate
    final acting = _Api()..shops = [_shopJson()];
    await tester.pumpWidget(_host(acting, onAuth: () => auth++));
    await tester.pumpAndSettle();
    acting.consentFailure = MobileApiException('AUTH_REQUIRED', 401, 'x');
    await tester.tap(find.byKey(const ValueKey('loyalty-consent-$_shop')));
    await tester.pumpAndSettle();
    expect(auth, 1);
  });
}
