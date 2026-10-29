import 'package:bitpos_customer/food_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'coupon_schedule_checkout_test.dart' show CheckoutApi, openCart, slot;
import 'food_cart_review_stage_test.dart' show id;

/// Every quote gets a fresh id and a short lease so the app has to replace it.
class LeaseApi extends CheckoutApi {
  LeaseApi({super.slots});
  int quotes = 0, couponApplies = 0;
  bool refuseCoupon = false;
  Object? couponFailure;
  @override
  Future<MobileFoodQuote> quoteFood(MobileFoodQuoteRequest request) async {
    final base = await super.quoteFood(request);
    final json = base.toJson();
    json['id'] = id(100 + quotes++);
    json['validUntil'] = DateTime.now()
        .toUtc()
        .add(const Duration(seconds: 30))
        .toIso8601String();
    return lastQuote = MobileFoodQuote.fromJson(json);
  }

  @override
  Future<MobileCouponQuote> applyFoodCoupon(
    String quoteId,
    MobileCouponApplyRequest request,
  ) async {
    applied.add((quoteId, request.code, request.idempotencyKey));
    couponApplies++;
    if (couponFailure != null) throw couponFailure!;
    if (refuseCoupon) {
      throw const MobileApiException('QUOTE_CHANGED', 409, 'COUPON_GLOBAL_LIMIT');
    }
    final json = lastQuote!.toJson();
    MobileMoney minor(String v) =>
        MobileMoney(currency: 'USD', decimals: 2, amountMinor: v);
    json['id'] = id(200 + couponApplies);
    json['discount'] = minor('30').toJson();
    json['total'] = minor('240').toJson();
    final configured = Map<String, dynamic>.from(json['configured'] as Map);
    configured['discount'] = minor('30').toJson();
    configured['total'] = minor('240').toJson();
    json['configured'] = configured;
    return MobileCouponQuote.fromJson({
      'couponCode': request.code,
      'sourceQuoteId': quoteId,
      'quote': json,
    });
  }
}

Future<void> applyCoupon(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const ValueKey('cart-coupon-entry')));
  await tester.tap(find.byKey(const ValueKey('cart-coupon-entry')));
  await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const ValueKey('coupon-code-field')), 'TRY50');
  await tester.tap(find.byKey(const ValueKey('coupon-apply-button')));
  await tester.pumpAndSettle();
}

Duration skew = Duration.zero;
DateTime skewed() => DateTime.now().add(skew);

void main() {
  setUp(() => skew = Duration.zero);
  testWidgets('lease refresh keeps the coupon (new key, new quote id) and the chosen slot', (tester) async {
    final a = slot(41);
    final api = LeaseApi(slots: [a]);
    await openCart(tester, api, clock: skewed);
    await applyCoupon(tester);
    expect(api.applied.length, 1);
    await tester.ensureVisible(find.byKey(const ValueKey('cart-schedule-entry')));
    await tester.tap(find.byKey(const ValueKey('cart-schedule-entry')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ValueKey('slot-${a.id}')));
    await tester.pumpAndSettle();
    // The 11 s lease is inside the 12 s margin at the next tick: automatic refresh.
    skew = const Duration(seconds: 25);
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(api.quotes, 2, reason: 'one automatic replacement quote');
    expect(api.applied.length, 2, reason: 'coupon re-applied on the replacement quote');
    expect(api.applied[1].$2, 'TRY50');
    expect(api.applied[1].$3, isNot(api.applied[0].$3), reason: 'a new attempt has its own key');
    expect(api.applied[1].$1, id(101), reason: 'applied against the new quote');
    expect(find.textContaining('Coupon TRY50'), findsWidgets);
    expect(find.textContaining('2.40'), findsWidgets);
    // Confirm: the hold and the order both use the replacement quote.
    await tester.tap(find.text('Continue to order review'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('review-scheduled-slot')), findsOneWidget);
    await tester.tap(find.textContaining('Confirm pickup order'));
    await tester.pumpAndSettle();
    expect(api.holds.single.$1, id(202), reason: 'slot held on the coupon-bearing replacement quote');
    expect(api.orders.single.quoteId, id(202));
  });

  testWidgets('a refused coupon on refresh shows one line instead of silently dropping it', (tester) async {
    final api = LeaseApi();
    await openCart(tester, api, thai: true, clock: skewed);
    await applyCoupon(tester);
    api.refuseCoupon = true;
    skew = const Duration(seconds: 25);
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('quote-notice')), findsOneWidget);
    expect(find.textContaining('ใส่คูปอง TRY50 กลับไม่ได้'), findsOneWidget);
    expect(find.textContaining('คูปองนี้ถูกใช้ครบแล้ว'), findsOneWidget);
    expect(find.textContaining('2.70'), findsWidgets, reason: 'full server price, no hidden discount');
  });

  testWidgets('a network failure while re-applying keeps the code and says to retry', (tester) async {
    final api = LeaseApi();
    await openCart(tester, api, clock: skewed);
    await applyCoupon(tester);
    api.couponFailure = const MobileApiException('REQUEST_FAILED', 503);
    skew = const Duration(seconds: 25);
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(find.textContaining('was not re-applied yet'), findsOneWidget);
  });

  testWidgets('removing the coupon is not undone by the next refresh', (tester) async {
    final api = LeaseApi();
    await openCart(tester, api, clock: skewed);
    await applyCoupon(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('cart-coupon-entry')));
    await tester.tap(find.byKey(const ValueKey('cart-coupon-entry')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('coupon-remove')));
    await tester.pumpAndSettle();
    final applies = api.couponApplies;
    skew = const Duration(seconds: 25);
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpAndSettle();
    expect(api.couponApplies, applies);
    expect(find.byKey(const ValueKey('review-coupon-line')), findsNothing);
    expect(find.textContaining('Coupon TRY50 ·'), findsNothing);
  });

  testWidgets('confirming on an expired lease refreshes and asks again instead of ordering on a stale price', (tester) async {
    final api = LeaseApi();
    await openCart(tester, api, clock: skewed);
    await applyCoupon(tester);
    await tester.tap(find.text('Continue to order review'));
    await tester.pumpAndSettle();
    skew = const Duration(seconds: 45);
    await tester.tap(find.textContaining('Confirm pickup order'));
    skew = Duration.zero; // the expiry check ran synchronously on the tap
    await tester.pumpAndSettle();
    expect(api.orders, isEmpty, reason: 'no order command on the stale quote');
    expect(api.quotes, 2);
    expect(find.textContaining('expired and was refreshed'), findsOneWidget);
    await tester.tap(find.textContaining('Confirm pickup order'));
    await tester.pumpAndSettle();
    expect(api.orders.single.quoteId, id(202), reason: 'second tap orders on the coupon-bearing refreshed quote');
  });
}
