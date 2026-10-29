import 'package:bitpos_customer/food_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_cart_review_stage_test.dart' show CartReviewApi, id;

/// Coupon and scheduled-order checkout: every price and slot below is returned by
/// the (fake) server; the app never computes a discount or a slot time.
class CheckoutApi extends CartReviewApi {
  CheckoutApi({this.slots = const [], this.couponError, this.slotsFail = false}) {
    failContinuation = false;
  }
  List<MobileScheduleSlot> slots;
  Object? couponError;
  bool slotsFail;
  final applied = <(String quoteId, String code, String key)>[];
  final holds = <(String quoteId, String slotId, String key)>[];
  final orders = <MobileFoodOrderRequest>[];
  Object? holdError;
  int _keys = 0;
  @override
  String newCommandKey() => id(900 + _keys++);
  @override
  bool get signedIn => false;
  @override
  Future<MobileCouponQuote> applyFoodCoupon(
    String quoteId,
    MobileCouponApplyRequest request,
  ) async {
    applied.add((quoteId, request.code, request.idempotencyKey));
    if (couponError != null) throw couponError!;
    final json = lastQuote!.toJson();
    MobileMoney minor(String v) => MobileMoney(currency: 'USD', decimals: 2, amountMinor: v);
    final discounted = minor('240').toJson();
    json['id'] = id(55);
    json['discount'] = minor('30').toJson();
    json['total'] = discounted;
    final configured = Map<String, dynamic>.from(json['configured'] as Map);
    configured['discount'] = minor('30').toJson();
    configured['total'] = discounted;
    json['configured'] = configured;
    return MobileCouponQuote.fromJson({
      'couponCode': request.code,
      'sourceQuoteId': quoteId,
      'quote': json,
    });
  }

  MobileFoodQuote? lastQuote;
  @override
  Future<MobileFoodQuote> quoteFood(MobileFoodQuoteRequest request) async =>
      lastQuote = await super.quoteFood(request);

  @override
  Future<MobileScheduleSlots> scheduleSlots(String branchId, String serving) async {
    if (slotsFail) throw const MobileApiException('REQUEST_FAILED', 500);
    return MobileScheduleSlots(branchId: branchId, serving: serving, slots: slots);
  }

  @override
  Future<MobileScheduleHold> holdScheduleSlot(
    String quoteId,
    MobileScheduleHoldRequest request,
  ) async {
    holds.add((quoteId, request.slotId, request.idempotencyKey));
    if (holdError != null) throw holdError!;
    final slot = slots.firstWhere((s) => s.id == request.slotId);
    return MobileScheduleHold(
      id: id(70),
      slotId: slot.id,
      quoteId: quoteId,
      state: 'HELD',
      expiresAt: slot.bookingClosesAt,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      replayed: false,
    );
  }

  @override
  Future<MobileFoodOrderResult> submitFoodOrder(MobileFoodOrderRequest command) async {
    orders.add(command);
    throw const MobileApiException('REQUEST_FAILED', 500);
  }
}

MobileScheduleSlot slot(int n, {int hours = 3}) {
  final start = DateTime.now().toUtc().add(Duration(hours: hours));
  return MobileScheduleSlot(
    id: id(n),
    startsAt: start.toIso8601String(),
    endsAt: start.add(const Duration(minutes: 30)).toIso8601String(),
    bookingClosesAt: start.subtract(const Duration(hours: 1)).toIso8601String(),
    timezone: 'Asia/Bangkok',
  );
}

Future<void> openCart(WidgetTester tester, CheckoutApi api, {bool thai = false}) async {
  addTearDown(api.close);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: FoodPage(api: api, thai: thai, onAuthenticationRequired: () {}),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text(thai ? 'ร้านทดสอบ' : 'Fixture branch'));
  await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField), 'food 500');
  await tester.pumpAndSettle();
  await tester.ensureVisible(find.text(thai ? 'เลือก / เพิ่ม' : 'Configure / add'));
  await tester.tap(find.text(thai ? 'เลือก / เพิ่ม' : 'Configure / add'));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
  await tester.ensureVisible(find.text(thai ? 'เพิ่มลงตะกร้า' : 'Add to cart'));
  await tester.tap(find.text(thai ? 'เพิ่มลงตะกร้า' : 'Add to cart'));
  await tester.pumpAndSettle();
  final review = find.textContaining(thai ? 'ตรวจตะกร้า' : 'Review cart');
  await tester.ensureVisible(review);
  await tester.tap(review);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('no published slots: schedule tile is an honest disabled state, never a picker', (tester) async {
    final api = CheckoutApi();
    await openCart(tester, api);
    final tile = find.byKey(const ValueKey('cart-schedule-entry'));
    expect(tile, findsOneWidget);
    expect(find.textContaining('does not offer scheduled orders yet'), findsOneWidget);
    expect(tester.widget<ListTile>(find.descendant(of: tile, matching: find.byType(ListTile))).enabled, isFalse);
    await tester.tap(tile, warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('slot-asap')), findsNothing);
  });

  testWidgets('slot load failure says so and stays immediate (TH)', (tester) async {
    final api = CheckoutApi(slotsFail: true);
    await openCart(tester, api, thai: true);
    expect(find.textContaining('โหลดช่วงเวลาไม่ได้'), findsOneWidget);
    expect(find.byKey(const ValueKey('cart-schedule-entry')), findsOneWidget);
  });

  testWidgets('published slots: picker lists server slots; chosen slot is held on the quote before the order command', (tester) async {
    final a = slot(21), b = slot(22, hours: 5);
    final api = CheckoutApi(slots: [a, b]);
    await openCart(tester, api);
    await tester.ensureVisible(find.byKey(const ValueKey('cart-schedule-entry')));
    await tester.tap(find.byKey(const ValueKey('cart-schedule-entry')));
    await tester.pumpAndSettle();
    expect(find.byKey(ValueKey('slot-${a.id}')), findsOneWidget);
    expect(find.byKey(ValueKey('slot-${b.id}')), findsOneWidget);
    expect(find.byKey(const ValueKey('slot-asap')), findsOneWidget);
    await tester.tap(find.byKey(ValueKey('slot-${b.id}')));
    await tester.pumpAndSettle();
    expect(find.textContaining('Scheduled '), findsWidgets);
    await tester.tap(find.text('Continue to order review'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('review-scheduled-slot')), findsOneWidget);
    await tester.tap(find.textContaining('Confirm pickup order'));
    await tester.pumpAndSettle();
    expect(api.holds.length, 1);
    expect(api.holds.single.$2, b.id);
    expect(api.orders.length, 1, reason: 'order command follows the hold');
    expect(api.orders.single.quoteId, api.holds.single.$1, reason: 'order uses the exact quote the slot is held on');
  });

  testWidgets('a refused slot hold creates no order and explains the typed reason', (tester) async {
    final a = slot(31);
    final api = CheckoutApi(slots: [a])
      ..holdError = const MobileApiException('QUOTE_CHANGED', 409, 'SCHEDULE_CAPACITY_EXHAUSTED');
    await openCart(tester, api);
    await tester.ensureVisible(find.byKey(const ValueKey('cart-schedule-entry')));
    await tester.tap(find.byKey(const ValueKey('cart-schedule-entry')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(ValueKey('slot-${a.id}')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue to order review'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Confirm pickup order'));
    await tester.pumpAndSettle();
    expect(api.holds.length, 1);
    expect(api.orders, isEmpty);
    expect(find.textContaining('That time slot is full'), findsOneWidget);
  });

  testWidgets('coupon code entry sends only code + key and shows the server returned discounted quote', (tester) async {
    final api = CheckoutApi();
    await openCart(tester, api);
    await tester.ensureVisible(find.byKey(const ValueKey('cart-coupon-entry')));
    await tester.tap(find.byKey(const ValueKey('cart-coupon-entry')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('coupon-code-field')), 'welcome-10');
    await tester.tap(find.byKey(const ValueKey('coupon-apply-button')));
    await tester.pumpAndSettle();
    expect(api.applied.single.$2, 'WELCOME-10');
    expect(api.applied.single.$3, id(900));
    expect(find.byKey(const ValueKey('coupon-code-field')), findsNothing, reason: 'page closed after the server accepted');
    expect(find.textContaining('Coupon WELCOME-10'), findsWidgets);
    expect(find.textContaining('applied. New total'), findsOneWidget);
    expect(find.textContaining('2.40'), findsWidgets, reason: 'server total 240 minor units is shown, not recomputed');
  });

  testWidgets('coupon refusal keeps the entry form, maps the reason and reuses the same key for the same code', (tester) async {
    final api = CheckoutApi()
      ..couponError = const MobileApiException('QUOTE_CHANGED', 409, 'COUPON_ACCOUNT_LIMIT');
    await openCart(tester, api, thai: true);
    await tester.ensureVisible(find.byKey(const ValueKey('cart-coupon-entry')));
    await tester.tap(find.byKey(const ValueKey('cart-coupon-entry')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const ValueKey('coupon-code-field')), 'ABC123');
    await tester.tap(find.byKey(const ValueKey('coupon-apply-button')));
    await tester.pumpAndSettle();
    expect(find.text('คุณใช้สิทธิ์คูปองนี้ครบแล้ว'), findsOneWidget);
    api.couponError = const MobileApiException('CONFIGURATION_REQUIRED', 503, 'COUPON_ZERO_ORDER_REQUIRES_COMPLETION');
    await tester.tap(find.byKey(const ValueKey('coupon-apply-button')));
    await tester.pumpAndSettle();
    expect(api.applied.map((e) => e.$3).toSet().length, 1, reason: 'retry of an unresolved code replays one server command');
    expect(find.textContaining('ซึ่งยังไม่รองรับ'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('coupon-code-field')), 'zz');
    await tester.tap(find.byKey(const ValueKey('coupon-apply-button')));
    await tester.pumpAndSettle();
    expect(api.applied.length, 2, reason: 'a code that cannot match the server shape is not sent');
    expect(find.text('ไม่พบรหัสคูปองนี้ ตรวจตัวสะกดแล้วลองใหม่'), findsOneWidget);
  });
}
