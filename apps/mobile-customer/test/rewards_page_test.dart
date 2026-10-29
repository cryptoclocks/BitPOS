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
  List<Map<String, Object?>> offers = [];
  List<Map<String, Object?>> vouchers_ = [];
  Object? redeemFailure;
  final redeemKeys = <String>[];
  @override
  Future<MobileRewardCatalog> rewardCatalog() async => MobileRewardCatalog.fromJson({
    'generatedAt': '2026-10-27T00:00:00Z',
    'rewards': offers,
  });
  @override
  Future<MobileVouchers> vouchers() async => MobileVouchers.fromJson({'generatedAt': '2026-10-27T00:00:00Z', 'vouchers': vouchers_});
  @override
  Future<MobileRewardRedemption> redeemReward(MobileRewardRedeemRequest request) async {
    redeemKeys.add(request.idempotencyKey);
    final failure = redeemFailure;
    if (failure != null) throw failure;
    offers = [for (final o in offers) {...o, 'balance': 0, 'redeemable': false}];
    final voucher = _voucher('11111111-1111-4111-8111-aaaaaaaaaaaa', 'AVAILABLE');
    vouchers_ = [voucher, ...vouchers_];
    return MobileRewardRedemption.fromJson({'voucher': voucher, 'balance': 0, 'replayed': false});
  }
  @override
  Future<MobileRewards> rewards() async {
    if (failure != null) throw failure!;
    return MobileRewards.fromJson({
      'generatedAt': '2026-10-27T00:00:00Z',
      'totals': totals,
    });
  }
}

const _shop = '22222222-2222-4222-8222-222222222222';
Map<String, Object?> _offer({int balance = 120, int cost = 100}) => {
  'id': '33333333-3333-4333-8333-333333333333',
  'merchantId': _shop,
  'merchantName': 'Test Cafe',
  'nameTh': 'ลด 20',
  'nameEn': '20 off',
  'currency': 'THB',
  'decimals': 2,
  'discountMinor': '2000',
  'minimumSpendMinor': '10000',
  'pointsCost': cost,
  'validityDays': 30,
  'balance': balance,
  'redeemable': balance >= cost,
};
Map<String, Object?> _voucher(String id, String state) => {
  'id': id,
  'rewardId': '33333333-3333-4333-8333-333333333333',
  'merchantId': _shop,
  'merchantName': 'Test Cafe',
  'nameTh': 'ลด 20',
  'nameEn': '20 off',
  'code': 'RW0123456789',
  'state': state,
  'expiresAt': '2026-11-30T00:00:00.000Z',
  'createdAt': '2026-10-29T00:00:00.000Z',
  'pointsSpent': 100,
  'currency': 'THB',
  'decimals': 2,
  'discountMinor': '2000',
  'minimumSpendMinor': '10000',
};

final _redeemButton = find.byKey(const ValueKey('redeem-33333333-3333-4333-8333-333333333333'));
Future<void> _tall(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(600, 3000));
  addTearDown(() => tester.binding.setSurfaceSize(null));
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
  testWidgets('shows per-currency derived points and no redeem button without offers', (
    tester,
  ) async {
    final api = _Api(), owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await _tall(tester);
    await tester.pumpWidget(_app(api, owner));
    await tester.pumpAndSettle();
    expect(find.text('126 points'), findsOneWidget);
    expect(find.text('USD · 3 orders'), findsOneWidget);
    expect(find.text('40 points'), findsOneWidget);
    expect(find.byKey(const ValueKey('rewards-offers-empty')), findsOneWidget);
    expect(find.byKey(const ValueKey('vouchers-empty')), findsOneWidget);
    expect(find.textContaining('not refunded'), findsOneWidget);
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

  testWidgets('redeem asks for confirmation, then lists the voucher and the new balance', (tester) async {
    final api = _Api()..offers = [_offer()], owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await _tall(tester);
    await tester.pumpWidget(_app(api, owner));
    await tester.pumpAndSettle();
    expect(find.text('Test Cafe'), findsOneWidget);
    expect(find.textContaining('You have 120 points at this shop'), findsOneWidget);
    expect(find.textContaining('THB 20.00 off food orders of at least THB 100.00'), findsOneWidget);
    final redeem = _redeemButton;
    await tester.tap(redeem);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('redeem-dialog')), findsOneWidget);
    expect(find.textContaining('not refunded'), findsWidgets);
    await tester.tap(find.byKey(const ValueKey('redeem-cancel')));
    await tester.pumpAndSettle();
    expect(api.redeemKeys, isEmpty, reason: 'cancel spends nothing');
    await tester.tap(redeem);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('redeem-confirm')));
    await tester.pumpAndSettle();
    expect(api.redeemKeys, hasLength(1));
    expect(find.byKey(const ValueKey('redeem-success')), findsOneWidget);
    expect(find.textContaining('Need 100 more points'), findsOneWidget);
    expect(find.byKey(const ValueKey('voucher-11111111-1111-4111-8111-aaaaaaaaaaaa')), findsOneWidget);
    expect(find.text('Code: RW0123456789'), findsOneWidget);
    expect(find.text('Ready to use'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('insufficient points disable redeem and say how many are missing', (tester) async {
    final api = _Api()..offers = [_offer(balance: 40)], owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await _tall(tester);
    await tester.pumpWidget(_app(api, owner));
    await tester.pumpAndSettle();
    expect(find.text('Need 60 more points'), findsOneWidget);
    expect(tester.widget<FilledButton>(_redeemButton).onPressed, isNull);
    expect(api.redeemKeys, isEmpty);
  });

  testWidgets('a lost response retries with the same key; definite refusals start over and explain', (tester) async {
    final api = _Api()..offers = [_offer()], owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await _tall(tester);
    await tester.pumpWidget(_app(api, owner));
    await tester.pumpAndSettle();
    Future<void> attempt() async {
      await tester.tap(_redeemButton);
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('redeem-confirm')));
      await tester.pumpAndSettle();
    }
    api.redeemFailure = const MobileApiException('REQUEST_FAILED', 503);
    await attempt();
    await attempt();
    expect(find.textContaining('you will not be charged points twice'), findsOneWidget);
    expect(api.redeemKeys, hasLength(2));
    expect(api.redeemKeys[0], api.redeemKeys[1], reason: 'same key after an ambiguous failure');
    api.redeemFailure = const MobileApiException('REWARD_INSUFFICIENT_POINTS', 409);
    await attempt();
    expect(find.text('You do not have enough points for this reward.'), findsOneWidget);
    api.redeemFailure = const MobileApiException('REWARD_UNAVAILABLE', 409);
    await attempt();
    expect(find.text('The shop has turned this reward off.'), findsOneWidget);
    expect(api.redeemKeys[3], isNot(api.redeemKeys[0]), reason: 'a definite refusal starts a new attempt');
    expect(api.redeemKeys[3], isNot(api.redeemKeys[2]));
    expect(tester.takeException(), isNull);
  });

  testWidgets('voucher states are server-derived and only ready vouchers show a code', (tester) async {
    final api = _Api()
      ..vouchers_ = [
        _voucher('11111111-1111-4111-8111-000000000001', 'AVAILABLE'),
        _voucher('11111111-1111-4111-8111-000000000002', 'IN_USE'),
        _voucher('11111111-1111-4111-8111-000000000003', 'USED'),
        _voucher('11111111-1111-4111-8111-000000000004', 'EXPIRED'),
      ];
    final owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    await tester.binding.setSurfaceSize(const Size(600, 3000));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(_app(api, owner, thai: true));
    await tester.pumpAndSettle();
    for (final label in ['พร้อมใช้', 'กำลังใช้อยู่ในออเดอร์', 'ใช้แล้ว', 'หมดอายุ']) {
      expect(find.text(label), findsOneWidget, reason: label);
    }
    expect(find.textContaining('รหัส: RW0123456789'), findsOneWidget, reason: 'only the ready voucher shows its code');
    expect(find.textContaining('ตะกร้า'), findsOneWidget);
  });

  testWidgets('a rewards load failure keeps the points and offers its own retry', (tester) async {
    final api = _Api();
    final owner = ValueNotifier(true);
    addTearDown(api.close);
    addTearDown(owner.dispose);
    final failing = _FailingCatalog();
    addTearDown(failing.close);
    await _tall(tester);
    await tester.pumpWidget(_app(failing, owner));
    await tester.pumpAndSettle();
    expect(find.text('126 points'), findsOneWidget);
    expect(find.byKey(const ValueKey('rewards-load-error')), findsOneWidget);
    failing.broken = false;
    await tester.tap(find.byKey(const ValueKey('rewards-retry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('rewards-load-error')), findsNothing);
    expect(find.byKey(const ValueKey('rewards-offers-empty')), findsOneWidget);
    api.close();
  });
}

class _FailingCatalog extends _Api {
  bool broken = true;
  @override
  Future<MobileRewardCatalog> rewardCatalog() async {
    if (broken) throw const MobileApiException('RESPONSE_UNAVAILABLE', 503);
    return super.rewardCatalog();
  }
}
