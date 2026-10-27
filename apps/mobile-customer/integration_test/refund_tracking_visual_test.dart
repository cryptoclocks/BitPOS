import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/order_refunds_sheet.dart';

String id(int value) =>
    '00000000-0000-4000-8000-${value.toString().padLeft(12, '0')}';

MobileFoodOrder fixtureOrder() {
  final total = MobileMoney(currency: 'THB', decimals: 2, amountMinor: '20500');
  return MobileFoodOrder(
    preparation: null,
    id: id(1024),
    merchantId: id(100),
    branchId: id(101),
    status: 'PAID',
    version: 2,
    acceptanceStatus: 'REJECTED',
    acceptanceVersion: 2,
    acceptanceDeadline: '2026-10-20T00:01:00Z',
    acceptanceReason: 'MERCHANT_DECLINED',
    eventSequence: '4',
    refunds: [
      MobileRefund(
        id: id(2048),
        version: '1',
        money: MobileMoney(
          currency: 'USDG',
          decimals: 6,
          amountMinor: '205000000',
        ),
        status: 'REQUESTED',
        cause: 'ONLINE_ACCEPTANCE_REJECTED',
      ),
    ],
    nextRefundCursor: null,
    fulfillmentStatus: 'RECEIVED',
    fulfillmentVersion: 0,
    createdAt: '2026-10-20T00:00:00Z',
    quoteExpiresAt: '2026-10-20T00:01:00Z',
    total: total,
    settlement: MobileSettlement(
      money: MobileMoney(
        currency: 'USDG',
        decimals: 6,
        amountMinor: '205000000',
      ),
      recipient: 'fixture',
      network: 'solana:devnet',
      genesisHash: 'fixture',
      mint: 'fixture',
      tokenProgram: 'fixture',
      testToken: true,
    ),
    lines: [
      MobileFoodLine(
        productId: id(102),
        name: 'กาแฟทดสอบ',
        nameEn: 'Fixture coffee',
        qty: 1,
        unitPrice: total,
        basePrice: total,
      ),
    ],
    paymentUrl: 'https://pay.bitpos.invalid/pay/fixture',
    configured: null,
    delivery: null,
  );
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('U25 refund page renders order actions and customer navigation', (
    tester,
  ) async {
    final api = MobileApi(
      base: Uri.parse('http://127.0.0.1/api/mobile/v1/'),
      fixture: true,
    );
    addTearDown(api.close);
    var viewOrder = false;
    var contactSupport = false;
    var selectedTab = -1;
    final order = fixtureOrder();
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: OrderRefundsSheet(
          api: api,
          orderId: order.id,
          order: order,
          firstPage: MobileFoodRefunds(
            refunds: order.refunds,
            nextCursor: null,
            generation: order.eventSequence,
          ),
          thai: true,
          onAuthenticationRequired: () => fail('Unexpected auth request'),
          onViewOrder: () => viewOrder = true,
          onContactSupport: () => contactSupport = true,
          onNavigation: (index) => selectedTab = index,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('ติดตามการคืนเงิน'), findsWidgets);
    expect(find.text('ดูสถานะออเดอร์'), findsOneWidget);
    expect(find.text('ติดต่อช่วยเหลือ'), findsOneWidget);
    expect(find.text('ออร์เดอร์'), findsOneWidget);
    expect(find.text('ออร์เดอร์'), findsOneWidget);
    debugPrint('BITPOS_U25_REFUND_PAGE_VISIBLE');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    await tester.ensureVisible(find.text('ดูสถานะออเดอร์'));
    await tester.tap(find.text('ดูสถานะออเดอร์'));
    await tester.tap(find.text('ติดต่อช่วยเหลือ'));
    await tester.tap(find.text('ออร์เดอร์'));
    expect(viewOrder, isTrue);
    expect(contactSupport, isTrue);
    expect(selectedTab, 1);
    binding.reportData = {
      'status': 'PASS_NATIVE_U25_REFUND_TRACKING_FIXTURE',
      'provider': 'not configured; no transfer attempted',
      'physicalTesting': 'deferred_by_user_2026-10-16',
    };
  });
}
