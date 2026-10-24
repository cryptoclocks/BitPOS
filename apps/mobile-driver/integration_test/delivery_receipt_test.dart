import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import '../test/delivery_receipt_test.dart' as receipt;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  receipt.main(capture: (tester, accrued) async {
    final scroll = tester.state<ScrollableState>(find.byType(Scrollable).first);
    scroll.position.jumpTo(0);
    await tester.pump(const Duration(milliseconds: 350));
    final geometry = <String, Object?>{};
    for (final key in ['food-delivery-return-to-work', 'food-delivery-success-badge', 'food-delivery-confirmation-time', 'food-delivery-obligation-status', 'food-delivery-next-job']) {
      final rect = tester.getRect(find.byKey(ValueKey(key)));
      geometry[key] = [rect.left, rect.top, rect.width, rect.height];
    }
    debugPrint('BITPOS_R14_GEOMETRY ${jsonEncode(geometry)}');
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 1)));
    debugPrint('BITPOS_R14_CAPTURE_READY_top_$accrued');
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 3)));
    await tester.ensureVisible(find.byKey(const ValueKey('food-delivery-next-job')));
    await tester.pump(const Duration(milliseconds: 350));
    debugPrint('BITPOS_R14_CAPTURE_READY_status_$accrued');
    await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 3)));
  });
}
