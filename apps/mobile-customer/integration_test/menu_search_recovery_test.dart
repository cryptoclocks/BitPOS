import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:bitpos_customer/presentation/merchant_branch_card.dart';
import 'package:bitpos_customer/presentation/food_product_card.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('actual local menu no-match clears without creating an order', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) throw StateError('Local fixture only');
    final base = Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API'));
    if (base.host != '10.0.2.2' || base.port != 3046) throw StateError('Named local W01 fixture only');
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))),
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
    });
    final api = MobileApi(base: base, fixture: true);
    addTearDown(api.close);
    await tester.runAsync(api.restore);
    final branches = await tester.runAsync(() => api.branches());
    MobileBranch? selected;
    for (final branch in branches!.branches) {
      final menu = await tester.runAsync(() => api.menu(branch.id));
      if (menu!.products.isNotEmpty && menu.products.every((p) => p.imageUrl.isEmpty || p.imageUrl.startsWith('/'))) {
        selected = branch;
        break;
      }
    }
    expect(selected, isNotNull, reason: 'Existing disposable local catalog required');
    Future<void> ready(bool Function() check) async {
      for (var n = 0; n < 150 && !check(); n++) {
        await tester.pump();
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      }
      if (!check()) {
        debugPrint('BITPOS_MENU_READINESS_FAILURE visibleText=${tester.widgetList<Text>(find.byType(Text)).map((text) => text.data).whereType<String>().join(' | ')}');
      }
      expect(check(), isTrue);
    }
    try {
      for (final thai in [false, true]) {
        await tester.pumpWidget(MaterialApp(theme: BitPosTheme.light(), home: Scaffold(body: SafeArea(child: Padding(padding: const EdgeInsets.all(24), child: SingleChildScrollView(child: FoodPage(key: ValueKey(thai), api: api, thai: thai, onAuthenticationRequired: () => fail('Fresh fixture session must remain active'))))))));
        final branch = find.byWidgetPredicate((w) => w is MerchantBranchCard && w.branch.id == selected!.id);
        await ready(() => branch.evaluate().isNotEmpty);
        await tester.ensureVisible(branch);
        await tester.tap(branch);
        await ready(() => find.byType(FoodProductCard).evaluate().isNotEmpty);
        final originalProducts = tester.widgetList<FoodProductCard>(find.byType(FoodProductCard)).map((w) => w.product.id).toSet();
        final search = find.byType(TextField);
        await tester.ensureVisible(search);
        await tester.enterText(search, 'zz-no-matching-local-menu-20261024');
        await tester.pumpAndSettle();
        expect(find.byType(FoodProductCard), findsNothing);
        expect(find.text(thai ? 'ไม่พบเมนูที่ตรงกับการค้นหา ล้างการค้นหาเพื่อดูเมนูทั้งหมด' : 'No matching menu items. Clear search to see all menu items.'), findsOneWidget);
        debugPrint('BITPOS_MENU_NO_MATCH_${thai ? 'TH' : 'EN'}');
        await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
        final clear = find.byTooltip(thai ? 'ล้างการค้นหาเมนู' : 'Clear menu search');
        await tester.ensureVisible(clear);
        await tester.tap(clear);
        await tester.pumpAndSettle();
        expect(tester.widgetList<FoodProductCard>(find.byType(FoodProductCard)).map((w) => w.product.id).toSet(), originalProducts);
        expect(find.byTooltip(thai ? 'ล้างการค้นหาเมนู' : 'Clear menu search'), findsNothing);
        debugPrint('BITPOS_MENU_RECOVERED_${thai ? 'TH' : 'EN'}');
        await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
      }
    } finally {
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.runAsync(api.logout);
    }
  });
}
