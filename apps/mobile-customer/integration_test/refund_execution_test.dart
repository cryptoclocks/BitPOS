import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/order_refunds_sheet.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('customer owned refund execution uses actual SDK and clears on revoked session', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) throw StateError('Explicit local fixture required');
    const orderId = String.fromEnvironment('BITPOS_TEST_ORDER_ID');
    const selected = bool.fromEnvironment('BITPOS_TEST_SELECTED_REFUND');
    const thai = bool.fromEnvironment('BITPOS_TEST_THAI');
    final checkLabel = thai ? 'ตรวจผลคืนเงินจริง' : 'Check refund execution';
    final executionLabel = selected ? (thai ? 'ยืนยันคืนเฉพาะรายการที่เลือก ไม่ใช่ยอดชำระทั้งหมด' : 'Selected line refunded; not all original payments') : (thai ? 'รอดำเนินการ ยังไม่ยืนยันโอนคืน' : 'Execution pending; transfer not confirmed');
    final session = jsonDecode(utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))));
    FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession': jsonEncode(session), 'bitpos.deviceId': '00000000-0000-4000-8000-000000000117'});
    final api = MobileApi(base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')), fixture: true);
    await api.restore();addTearDown(api.close);
    final before = await api.foodRefundExecution(orderId);expect(before.orderId, orderId);expect(before.execution?.state, selected ? 'SELECTED_FINALIZED' : 'PENDING');expect(before.execution?.allPaymentsRefunded, false);
    if(selected){expect(before.execution?.selectedRefund?.refundAmount.amountMinor,'2700000');expect(before.execution?.selectedRefund?.refundAmount.currency,'USDG');}
    final first = await api.foodRefunds(orderId);var auth = 0;
    await tester.pumpWidget(MaterialApp(theme: BitPosTheme.light(), home: OrderRefundsSheet(api: api, orderId: orderId, firstPage: first, thai: thai, onAuthenticationRequired: () => auth++)));
    Future<void> waitText(String text) async { final deadline = DateTime.now().add(const Duration(seconds: 30));while(find.text(text).evaluate().isEmpty && DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds: 200));}expect(find.text(text), findsOneWidget); }
    await waitText(checkLabel);await tester.ensureVisible(find.text(checkLabel));await tester.pumpAndSettle();await tester.tap(find.text(checkLabel));await waitText(executionLabel);
    if(selected)expect(find.byWidgetPredicate((w)=>w is Text&&(w.data?.contains('2.700000')??false)&&(w.data?.contains('USDG')??false)),findsOneWidget);
    expect(find.text(thai ? 'ยืนยันคืนเงินครบจากหลักฐานแล้ว' : 'All payments refunded with finalized evidence'), findsNothing);debugPrint(selected?'BITPOS_CUSTOMER_REFUND_SELECTED_FINALIZED':'BITPOS_CUSTOMER_REFUND_PENDING');
    // Parent revokes the synthetic session only after this UI marker.
    await tester.runAsync(() => Future<void>.delayed(Duration(seconds: selected ? 5 : 2)));
    await tester.tap(find.text(checkLabel));await waitText(thai ? 'ยังตรวจผลไม่ได้ กรุณาลองใหม่' : 'Execution status unavailable. Try again.');
    expect(find.text(executionLabel), findsNothing);if(selected)expect(find.textContaining('2.700000'),findsNothing);expect(auth, 1);expect(tester.takeException(), isNull);debugPrint('BITPOS_CUSTOMER_REFUND_REVOKED');
  });
}
