import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/configured_food_lines.dart';

import 'food_cart_review_stage_test.dart' show CartReviewApi;
import 'notification_owner_test.dart' show PushNative;
import 'customer_onboarding_ui_test.dart' show loadFonts;

class SessionCartApi extends CartReviewApi {
  SessionCartApi(this.thai) {
    failContinuation = false;
  }
  final bool thai;
  Completer<void>? quoteGate;
  int quoteCalls = 0;
  bool deliveryPresentation = false;
  @override
  Future<MobileFoodQuote> quoteFood(MobileFoodQuoteRequest request) async {
    quoteCalls++;
    await quoteGate?.future;
    final quote = await super.quoteFood(request);
    if (!deliveryPresentation) return quote;
    final json = quote.toJson();
    json['delivery'] = MobileFoodDeliverySnapshot(
      addressId: '00000000-0000-4000-8000-000000000060',
      addressVersion: '1',
      policyVersionId: '00000000-0000-4000-8000-000000000061',
      recipientName: 'Fixture recipient',
      phone: '+66900000001',
      addressText: thai
          ? 'บ้านทดสอบ · สุขุมวิท 49'
          : 'Fixture home · Sukhumvit 49',
      instructions: thai
          ? 'วางที่โต๊ะหน้าประตู'
          : 'Leave on the table by the door',
      latitudeE7: 137000000,
      longitudeE7: 1005000000,
      deliveryFee: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
      serviceFee: MobileMoney(currency: 'USD', decimals: 2, amountMinor: '0'),
      fixture: true,
    ).toJson();
    return MobileFoodQuote.fromJson(json);
  }

  @override
  bool get signedIn => true;
  @override
  ({String accountId, String sessionId}) get sessionScope => (
    accountId: '00000000-0000-4000-8000-000000000050',
    sessionId: '00000000-0000-4000-8000-000000000051',
  );
  @override
  Stream<({String accountId, String sessionId})?> get sessionScopes =>
      const Stream.empty();
  @override
  Future<void> restore() async {}
  @override
  Future<MobileAccount> account() async => MobileAccount(
    id: sessionScope.accountId,
    displayName: 'Local fixture',
    locale: thai ? 'th' : 'en',
  );
  @override
  Future<MobilePushStatus> pushStatus(MobilePushApp app, String key) async =>
      MobilePushStatus(
        installation: MobilePushUnregistered(
          kind: 'UNREGISTERED',
          revision: '0',
        ),
        endpointEncryptionAvailable: true,
      );
}

void main() {
  for (final variant in [
    (true, false, false, false),
    (false, false, false, false),
    (true, true, false, false),
    (true, false, true, false),
    (false, false, true, false),
    (true, false, false, true),
    (false, false, false, true),
  ]) {
    final (thai, accessible, expired, deliveryPresentation) = variant;
    testWidgets(
      'actual session cart quote then review and back thai=$thai accessible=$accessible expired=$expired delivery=$deliveryPresentation',
      (tester) async {
        await loadFonts(tester);
        await tester.binding.setSurfaceSize(Size(accessible ? 320 : 390, 844));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        FlutterSecureStorage.setMockInitialValues({});
        final api = SessionCartApi(thai)
          ..deliveryPresentation = deliveryPresentation;
        if (expired) api.quoteLifetime = const Duration(seconds: -1);
        if (accessible) api.quoteGate = Completer<void>();
        addTearDown(api.close);
        final boundary = GlobalKey();
        await tester.pumpWidget(
          RepaintBoundary(
            key: boundary,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: accessible ? BitPosTheme.dark() : BitPosTheme.light(),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: TextScaler.linear(accessible ? 1.5 : 1),
                  padding: const EdgeInsets.only(top: 44, bottom: 34),
                  viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
                ),
                child: child!,
              ),
              home: CustomerSessionPage(api: api, pushNative: PushNative()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        Future<void> tap(Finder target) async {
          await tester.ensureVisible(target);
          await tester.tap(target);
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 400));
        }

        Future<void> capture(String state) async {
          final out = Platform.environment['BITPOS_DS05_CAPTURE_DIR'];
          if (out == null) return;
          final render =
              boundary.currentContext!.findRenderObject()!
                  as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final image = await render.toImage(pixelRatio: 1);
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final f = File(
              '$out/session-$state-$thai-$accessible-$expired-$deliveryPresentation.png',
            );
            await f.create(exclusive: true);
            await f.writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }

        await tap(find.text(thai ? 'ร้านทดสอบ' : 'Fixture branch'));
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), '500');
        await tester.pumpAndSettle();
        await tap(find.text(thai ? 'เลือก / เพิ่ม' : 'Configure / add'));
        await tap(find.text(thai ? 'เพิ่มลงตะกร้า' : 'Add to cart'));
        await tester.pumpAndSettle();
        if (deliveryPresentation) {
          await tap(find.text(thai ? 'เลือก / เพิ่ม' : 'Configure / add'));
          await tap(find.text(thai ? 'เพิ่มลงตะกร้า' : 'Add to cart'));
          await tester.pumpAndSettle();
        }
        await tap(
          find.text(
            thai
                ? 'ตรวจตะกร้า · ${deliveryPresentation ? 2 : 1}'
                : 'Review cart · ${deliveryPresentation ? 2 : 1}',
          ),
        );
        if (accessible) {
          expect(find.byType(LinearProgressIndicator), findsOneWidget);
          expect(api.quoteCalls, 1);
          await tester.tap(find.text('ตรวจตะกร้า · 1'), warnIfMissed: false);
          await tester.pump(const Duration(milliseconds: 100));
          expect(api.quoteCalls, 1);
          api.quoteGate!.complete();
        }

        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('customer-cart-review-bottom-action')),
          findsOneWidget,
        );
        expect(find.text(thai ? 'ตะกร้าของคุณ' : 'Your cart'), findsOneWidget);
        expect(find.text(thai ? 'ส่วนลด' : 'Discount'), findsNothing);
        expect(
          find.text(thai ? 'ค่าธรรมเนียมรวม' : 'Total fees'),
          findsNothing,
        );
        expect(
          find.text(thai ? 'ภาษีเพิ่มเติม' : 'Additional tax'),
          findsNothing,
        );
        if (!accessible) {
          expect(
            tester.getRect(find.byType(ConfiguredFoodLines)).top,
            closeTo(137, 1),
          );
          expect(tester.getRect(find.byType(ConfiguredFoodLines)).left, 24);
          expect(tester.getRect(find.byType(ConfiguredFoodLines)).width, 342);
        }
        if (!accessible) {
          expect(
            tester
                .getRect(
                  find.byKey(
                    const ValueKey('customer-cart-review-bottom-action'),
                  ),
                )
                .top,
            closeTo(686, 1),
          );
        }
        await capture('cart');
        await tap(find.byKey(const ValueKey('cart-coupon-entry')));
        await tester.pumpAndSettle();
        // The fake API publishes no coupon route result, but the entry form itself is real.
        expect(find.byKey(const ValueKey('coupon-code-field')), findsOneWidget);
        expect(
          find.text(thai ? 'ใช้คูปอง' : 'Apply coupon'),
          findsOneWidget,
        );
        await capture('coupon-entry');
        await tap(find.text(thai ? 'กลับไปตะกร้า' : 'Back to cart'));
        await tester.pumpAndSettle();
        expect(find.byType(ConfiguredFoodLines), findsOneWidget);

        await tap(
          find.byKey(const ValueKey('customer-cart-review-bottom-action')),
        );
        await tester.pumpAndSettle();
        expect(
          tester
              .widget<Text>(
                find.byKey(const ValueKey('quote-confirmation-total')),
              )
              .data,
          contains(deliveryPresentation ? '5.40' : '2.70'),
        );
        if (!accessible) {
          expect(
            tester.getRect(find.byType(ConfiguredFoodLines)).top,
            closeTo(137, 1),
          );
          final confirmButton = find.ancestor(
            of: find.byKey(const ValueKey('quote-confirmation-total')),
            matching: find.byType(FilledButton),
          );
          expect(tester.getRect(confirmButton).left, 24);
          expect(tester.getRect(confirmButton).top, closeTo(730, 1));
        }
        await capture('review');
        if (deliveryPresentation) {
          expect(
            tester
                .widget<ConfiguredFoodLines>(find.byType(ConfiguredFoodLines))
                .lines
                .length,
            2,
          );
          final quoted = tester
              .widget<ConfiguredFoodLines>(find.byType(ConfiguredFoodLines))
              .lines;
          final first = tester.getRect(
            find.byKey(ValueKey(quoted.first.lineId)),
          );
          final second = tester.getRect(
            find.byKey(ValueKey(quoted.last.lineId)),
          );
          expect(first.height, greaterThanOrEqualTo(82));
          expect(second.top - first.top, closeTo(first.height, 1));
          expect(first.left, 24);
          expect(second.width, 342);

          final address = find.text(
            thai ? 'บ้านทดสอบ · สุขุมวิท 49' : 'Fixture home · Sukhumvit 49',
          );
          await tap(address);
          await tester.pumpAndSettle();
          expect(find.text('Fixture recipient · +66900000001'), findsOneWidget);
          expect(
            find.text(thai ? 'ค่าจัดส่ง' : 'Delivery fee'),
            findsOneWidget,
          );
          expect(find.text(thai ? 'ค่าบริการ' : 'Service fee'), findsOneWidget);
          expect(
            find.textContaining(thai ? 'ข้อมูลทดสอบ' : 'FIXTURE'),
            findsOneWidget,
          );
          await capture('delivery-expanded');
          await tap(address);
          await tester.pumpAndSettle();
        }

        if (expired) {
          expect(
            find.textContaining(
              thai ? 'ราคานี้หมดอายุแล้ว' : 'This quote has expired',
            ),
            findsOneWidget,
          );
          final confirm = find.ancestor(
            of: find.byKey(const ValueKey('quote-confirmation-total')),
            matching: find.byType(FilledButton),
          );
          expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
          await tap(find.byTooltip(thai ? 'กลับไปตะกร้า' : 'Back to cart'));
          api.quoteLifetime = const Duration(minutes: 2);
          await tap(find.text(thai ? 'อัปเดตราคา' : 'Refresh server quote'));
          await tester.pumpAndSettle();
          await tap(
            find.byKey(const ValueKey('customer-cart-review-bottom-action')),
          );
          await tester.pumpAndSettle();
          expect(
            find.textContaining(
              thai ? 'ราคานี้หมดอายุแล้ว' : 'This quote has expired',
            ),
            findsNothing,
          );
          expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);
        }

        expect(find.textContaining(thai ? 'USDG' : 'USDG'), findsWidgets);
        await tap(find.byTooltip(thai ? 'กลับไปตะกร้า' : 'Back to cart'));
        await tester.pumpAndSettle();
        expect(
          find.byKey(const ValueKey('customer-cart-review-bottom-action')),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}
