import 'package:bitpos_customer/presentation/cart_coupon_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

MobileVoucher _voucher() => MobileVoucher.fromJson({
  'id': '11111111-1111-4111-8111-aaaaaaaaaaaa',
  'rewardId': '33333333-3333-4333-8333-333333333333',
  'merchantId': '22222222-2222-4222-8222-222222222222',
  'merchantName': 'Test Cafe',
  'nameTh': 'ลด 20',
  'nameEn': '20 off',
  'code': 'RW0123456789',
  'state': 'AVAILABLE',
  'expiresAt': '2026-11-30T00:00:00.000Z',
  'createdAt': '2026-10-29T00:00:00.000Z',
  'pointsSpent': 100,
  'currency': 'THB',
  'decimals': 2,
  'discountMinor': '2000',
  'minimumSpendMinor': '10000',
});

void main() {
  testWidgets('tapping a reward voucher only fills the code; the server still decides and refusals are explained', (tester) async {
    final sent = <String>[];
    await tester.pumpWidget(
      MaterialApp(
        home: CartCouponPage(
          thai: false,
          vouchers: [_voucher()],
          newKey: () => '44444444-4444-4444-8444-444444444444',
          onApply: (code, key) async {
            sent.add(code);
            throw const MobileApiException(
              'QUOTE_CHANGED',
              409,
              'COUPON_REWARD_VOUCHER_REQUIRED',
            );
          },
        ),
      ),
    );
    expect(find.text('Your reward vouchers at this shop'), findsOneWidget);
    expect(sent, isEmpty);
    await tester.tap(find.byKey(const ValueKey('coupon-voucher-11111111-1111-4111-8111-aaaaaaaaaaaa')));
    await tester.pump();
    expect(find.text('RW0123456789'), findsOneWidget, reason: 'the code is placed in the field');
    await tester.tap(find.byKey(const ValueKey('coupon-apply-button')));
    await tester.pumpAndSettle();
    expect(sent, ['RW0123456789']);
    expect(find.textContaining('needs an unused reward voucher'), findsOneWidget);
  });
  testWidgets('without vouchers the entry looks exactly as before', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: CartCouponPage(thai: false, newKey: () => 'k', onApply: (c, k) async => throw StateError('unused')),
      ),
    );
    expect(find.text('Your reward vouchers at this shop'), findsNothing);
    expect(find.byKey(const ValueKey('coupon-code-field')), findsOneWidget);
  });
}
