import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/configured_food_lines.dart';

import 'food_root_navigation_test.dart' show RootChatApi;
import 'food_history_test.dart' as fixture;
import 'notification_owner_test.dart' show PushNative;

class OrderPhaseRootApi extends RootChatApi {
  OrderPhaseRootApi(this.phase, {this.thai = true});
  String phase;
  final bool thai;
  @override
  Future<void> restore() async {}
  @override
  Future<MobileAccount> account() async => MobileAccount(
    id: fixture.id(50),
    displayName: 'Synthetic customer',
    locale: thai ? 'th' : 'en',
  );
  @override
  Future<String?> activeFoodOrderId() async => fixture.id(1);
  @override
  MobileFoodOrder get deliveredOrder => MobileFoodOrder.fromJson({
    ...super.deliveredOrder.toJson(),
    'status': phase == 'CONFIRMING' ? phase : 'PAID',
    'acceptanceStatus': phase == 'CONFIRMING' ? 'PENDING' : 'ACCEPTED',
    'fulfillmentStatus': phase == 'CONFIRMING' ? 'RECEIVED' : phase,
    'delivery': null,
  });
}

Future<void> loadOrderPhaseFonts() async {
  for (final family in ['NotoSansThai', 'Inter']) {
    await (FontLoader('packages/mobile_shared/$family')..addFont(
          rootBundle.load(
            'packages/mobile_shared/assets/fonts/$family-Variable.ttf',
          ),
        ))
        .load();
  }
}

void registerOrderPhaseRootTests({
  bool native = false,
  Future<void> Function(WidgetTester tester, String stage)? capture,
}) {
  for (final thai in [true, false]) {
    for (final phase in ['RECEIVED', 'PREPARING']) {
      testWidgets(
        'owned $phase summary opens canonical details and returns thai=$thai',
        (tester) async {
          FlutterSecureStorage.setMockInitialValues({});
          await loadOrderPhaseFonts();
          if (!native) {
            await tester.binding.setSurfaceSize(const Size(390, 844));
            addTearDown(() => tester.binding.setSurfaceSize(null));
          }
          final api = OrderPhaseRootApi(phase, thai: thai);
          addTearDown(api.close);
          await tester.pumpWidget(
            MaterialApp(
              theme: BitPosTheme.light(),
              home: CustomerSessionPage(api: api, pushNative: PushNative()),
            ),
          );
          await tester.pumpAndSettle();
          final title = phase == 'PREPARING'
              ? (thai ? 'กำลังเตรียมมื้อของคุณ' : 'Preparing your meal')
              : (thai ? 'ร้านรับออร์เดอร์แล้ว' : 'Order accepted');
          expect(
            find.descendant(
              of: find.byType(AppBar),
              matching: find.text(title),
            ),
            findsOneWidget,
          );
          expect(find.byType(ConfiguredFoodLines), findsNothing);
          final pill = find
              .ancestor(
                of: find.text('${thai ? 'ออร์เดอร์' : 'Order'} #00000000'),
                matching: find.byType(Container),
              )
              .first;
          final pillRect = tester.getRect(pill);
          expect(pillRect.width, closeTo(142, 1));
          expect(pillRect.height, closeTo(30, 1));
          await capture?.call(tester, '$phase-${thai ? 'th' : 'en'}-summary');
          final details = find.text(
            thai ? 'ดูรายละเอียดออร์เดอร์' : 'View order details',
          );
          await tester.ensureVisible(details);
          await tester.tap(details);
          await tester.pumpAndSettle();
          expect(find.byType(ConfiguredFoodLines), findsOneWidget);
          expect(
            find.descendant(
              of: find.byType(AppBar),
              matching: find.text(
                thai ? 'รายละเอียดออร์เดอร์' : 'Order details',
              ),
            ),
            findsOneWidget,
          );
          await capture?.call(tester, '$phase-${thai ? 'th' : 'en'}-detail');
          await tester.tap(
            find.byTooltip(
              thai ? 'กลับไปสถานะออร์เดอร์' : 'Back to order status',
            ),
          );
          await tester.pumpAndSettle();
          expect(find.byType(ConfiguredFoodLines), findsNothing);
          expect(
            find.descendant(
              of: find.byType(AppBar),
              matching: find.text(title),
            ),
            findsOneWidget,
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  }
  testWidgets(
    'original confirming order refresh advances the owned phase without exposing hybrid details',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final api = OrderPhaseRootApi('CONFIRMING');
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          theme: BitPosTheme.light(),
          home: CustomerSessionPage(api: api, pushNative: PushNative()),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.text('กำลังตรวจสอบการชำระเงิน'),
        ),
        findsOneWidget,
      );
      expect(find.byType(ConfiguredFoodLines), findsNothing);
      await capture?.call(tester, 'CONFIRMING-th-summary');
      api.phase = 'RECEIVED';
      final refresh = find.text('ดูสถานะออร์เดอร์');
      await tester.ensureVisible(refresh);
      await tester.tap(refresh);
      await tester.pumpAndSettle();
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.text('ร้านรับออร์เดอร์แล้ว'),
        ),
        findsOneWidget,
      );
      expect(find.byType(ConfiguredFoodLines), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}

void main() => registerOrderPhaseRootTests();
