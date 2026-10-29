import 'package:bitpos_customer/rewards_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

class _Api extends MobileApi {
  _Api()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  Object? failure;
  List<Map<String, Object?>> totals = [
    {'currency': 'USD', 'decimals': 2, 'orders': 3, 'points': 126},
    {'currency': 'THB', 'decimals': 2, 'orders': 1, 'points': 40},
  ];
  @override
  Future<MobileRewards> rewards() async {
    if (failure != null) throw failure!;
    return MobileRewards.fromJson({
      'generatedAt': '2026-10-27T00:00:00Z',
      'totals': totals,
    });
  }
}

Widget _app(
  _Api api,
  ValueNotifier<bool> owner, {
  bool thai = false,
  VoidCallback? onAuth,
}) => MaterialApp(
  home: RewardsPage(
    key: ValueKey(api),
    api: api,
    owner: owner,
    thai: thai,
    onAuthenticationRequired: onAuth ?? () {},
  ),
);

void main() {
  testWidgets('shows per-currency derived points and never offers redemption', (
    tester,
  ) async {
    final api = _Api(), owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.pumpWidget(_app(api, owner));
    await tester.pumpAndSettle();
    expect(find.text('126 points'), findsOneWidget);
    expect(find.text('USD · 3 orders'), findsOneWidget);
    expect(find.text('40 points'), findsOneWidget);
    expect(
      find.textContaining('Redeeming rewards is not available yet'),
      findsOneWidget,
    );
    expect(
      find.textContaining('Redeem'),
      findsOneWidget,
      reason: 'only the explanatory sentence mentions redeeming',
    );
    expect(find.byType(FilledButton), findsNothing);
    expect(tester.takeException(), isNull);
  });
  testWidgets('empty, failure with retry, auth delegation and owner loss', (
    tester,
  ) async {
    final owner = ValueNotifier(true);
    addTearDown(owner.dispose);
    final empty = _Api()..totals = [];
    addTearDown(empty.close);
    await tester.pumpWidget(_app(empty, owner, thai: true));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('rewards-empty')), findsOneWidget);
    final failing = _Api()
      ..failure = const MobileApiException('RESPONSE_UNAVAILABLE', 503);
    addTearDown(failing.close);
    await tester.pumpWidget(_app(failing, owner));
    await tester.pumpAndSettle();
    expect(find.textContaining('Could not load your points'), findsOneWidget);
    failing.failure = null;
    await tester.tap(find.text('Try again'));
    await tester.pumpAndSettle();
    expect(find.text('126 points'), findsOneWidget);
    var auth = 0;
    final denied = _Api()
      ..failure = const MobileApiException('AUTH_REQUIRED', 401);
    addTearDown(denied.close);
    await tester.pumpWidget(_app(denied, owner, onAuth: () => auth++));
    await tester.pumpAndSettle();
    expect(auth, 1);
    final api = _Api();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => RewardsPage(
                    api: api,
                    owner: owner,
                    thai: false,
                    onAuthenticationRequired: () {},
                  ),
                ),
              ),
              child: const Text('Open rewards'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open rewards'));
    await tester.pumpAndSettle();
    expect(find.text('BitPOS Rewards'), findsOneWidget);
    owner.value = false;
    await tester.pumpAndSettle();
    expect(find.text('BitPOS Rewards'), findsNothing);
  });
}
