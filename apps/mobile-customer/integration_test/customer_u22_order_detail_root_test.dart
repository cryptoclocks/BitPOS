import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/configured_food_lines.dart';

import '../test/food_history_test.dart' as history_fixture;
import '../test/food_root_navigation_test.dart' show RootChatApi;
import '../test/notification_owner_test.dart' show PushNative;

class U22RootApi extends RootChatApi {
  // Two immutable fixture lines exercise the full U22 design grid.
  @override
  MobileFoodOrder get deliveredOrder {
    final source = super.deliveredOrder.toJson();
    final snapshot = Map<String, dynamic>.from(source['configured'] as Map);
    final first = Map<String, dynamic>.from(
      (snapshot['lines'] as List).single as Map,
    );
    snapshot['lines'] = [
      first,
      {
        ...first,
        'lineId': history_fixture.id(402),
        'name': 'ขนมทดสอบ',
        'nameEn': 'Fixture pastry',
      },
    ];
    snapshot['subtotal'] = {
      ...Map<String, dynamic>.from(snapshot['subtotal'] as Map),
      'amountMinor': '600',
    };
    snapshot['discount'] = {
      ...Map<String, dynamic>.from(snapshot['discount'] as Map),
      'amountMinor': '60',
    };
    snapshot['total'] = {
      ...Map<String, dynamic>.from(snapshot['total'] as Map),
      'amountMinor': '540',
    };
    return MobileFoodOrder.fromJson({
      ...source,
      'configured': snapshot,
      'total': snapshot['total'],
    });
  }

  @override
  Future<void> restore() async {}

  @override
  Future<MobileAccount> account() async => MobileAccount(
    id: history_fixture.id(50),
    displayName: 'Synthetic customer',
    locale: 'th',
  );
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('U22 opens the selected owned order from CustomerSessionPage', (
    tester,
  ) async {
    final api = U22RootApi();
    expect(api.deliveredOrder.configured!.lines, hasLength(2));
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: CustomerSessionPage(api: api, pushNative: PushNative()),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
    await tester.tap(find.text('กิจกรรม'));
    await tester.pumpAndSettle();
    final orderKey = ValueKey('customer-order-card.${history_fixture.id(1)}');
    expect(find.byKey(orderKey), findsOneWidget);
    await tester.tap(find.byKey(orderKey));
    await tester.pumpAndSettle();

    final back = tester.getRect(find.byTooltip('กลับไปออเดอร์'));
    final lines = tester.getRect(find.byType(ConfiguredFoodLines));
    final destination = tester.getRect(
      find.byKey(const ValueKey('customer-order-detail-destination')),
    );
    debugPrint('BITPOS_U22_GEOMETRY:$back,$lines,$destination');
    expect(back.left, closeTo(18, 1));
    expect(back.top, closeTo(52, 1));
    expect(back.width, closeTo(44, 1));
    expect(back.height, closeTo(44, 1));
    expect(lines.left, closeTo(24, 1));
    expect(lines.top, closeTo(137, 1));
    expect(lines.width, closeTo(342, 1));
    expect(lines.height, closeTo(188, 1));
    expect(destination.top, closeTo(533, 1));
    expect(find.textContaining('ขนมทดสอบ'), findsOneWidget);
    expect(find.textContaining('ลาเต้ทดสอบ'), findsOneWidget);
    expect(find.text('Food subtotal'), findsNothing);
    expect(find.text('ค่าอาหาร'), findsOneWidget);
    expect(find.text('Synthetic destination'), findsOneWidget);
    expect(find.text('ติดตามการจัดส่ง'), findsOneWidget);
    expect(find.text('รายละเอียดออเดอร์'), findsOneWidget);
    expect(find.text('BitPOS'), findsNothing);
    expect(
      find.byKey(const ValueKey('customer-order-detail-track-action')),
      findsOneWidget,
    );
    debugPrint('BITPOS_U22_ROOT_AVD_VISIBLE');
    expect(tester.takeException(), isNull);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 500)),
    );
    await tester.tap(find.text('Synthetic destination'));
    await tester.pumpAndSettle();
    expect(find.text('Fixture recipient · +66900000001'), findsOneWidget);
    expect(find.text('ข้อมูลทดสอบ · ตำแหน่งและค่าจัดส่งจำลอง'), findsOneWidget);
    await tester.tap(find.byTooltip('กลับไปออเดอร์'));
    await tester.pumpAndSettle();
    expect(find.byKey(orderKey), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
