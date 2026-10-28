import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/food_review_page.dart';

import '../test/food_review_page_test.dart' show ReviewApi, order;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('U21 delivered root follows FigCraft geometry on Android', (
    tester,
  ) async {
    final api = ReviewApi();
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: FoodReviewPage(
          api: api,
          orderId: order,
          thai: true,
          owner: null,
          onAuthenticationRequired: () {},
          deliveryCompleteScreen: true,
          orderTotal: MobileMoney(
            currency: 'THB',
            decimals: 2,
            amountMinor: '20500',
          ),
          onViewReceipt: () {},
          onNavigationSelected: (_) {},
        ),
      ),
    );
    await tester.pumpAndSettle();

    final back = tester.getRect(
      find
          .descendant(
            of: find.byType(AppBar),
            matching: find.byType(IconButton),
          )
          .first,
    );
    final title = tester.getRect(find.text('อิ่มอร่อยได้เลย'));
    final success = tester.getRect(find.byType(CircleAvatar).first);
    final delivered = tester.getRect(find.text('ส่งถึงมือคุณแล้ว'));
    final stars = tester.getRect(
      find
          .ancestor(of: find.byTooltip('1 / 5'), matching: find.byType(Row))
          .first,
    );
    final prompt = tester.getRect(find.text('บอกเล่าประสบการณ์ของคุณ'));
    final input = tester.getRect(find.byType(TextField).first);
    final submit = tester.getRect(
      find
          .ancestor(
            of: find.text('ส่งรีวิว'),
            matching: find.byType(FilledButton),
          )
          .first,
    );
    final receipt = tester.getRect(
      find
          .ancestor(
            of: find.text('ดูใบเสร็จ'),
            matching: find.byType(OutlinedButton),
          )
          .first,
    );
    final navigation = tester.getRect(
      find
          .ancestor(
            of: find.byType(NavigationBar),
            matching: find.byType(ColoredBox),
          )
          .first,
    );
    final starCenters = [
      for (var n = 1; n <= 5; n++)
        tester.getCenter(find.byTooltip('$n / 5')).dx,
    ];
    debugPrint(
      'BITPOS_U21_GEOMETRY:${back.toString()},${title.toString()},${success.toString()},${delivered.toString()},${stars.toString()},${starCenters.toString()},${prompt.toString()},${input.toString()},${submit.toString()},${receipt.toString()},${navigation.toString()}',
    );
    debugPrint('BITPOS_U21_ROOT_AVD_VISIBLE');

    expect(back.left, closeTo(18, 1));
    // The app bar is 72 dp tall with the 44 dp back button centred (14 dp padding) below the device's top safe area.
    final inset = tester.view.padding.top / tester.view.devicePixelRatio;
    expect(back.top, closeTo(inset + 14, 1));
    expect(back.width, closeTo(44, 1));
    expect(back.height, closeTo(44, 1));
    expect(title.left, closeTo(76, 1));
    expect(success.left, closeTo(141, 1));
    expect(success.top, closeTo(155, 1));
    expect(success.width, closeTo(108, 1));
    expect(success.height, closeTo(108, 1));
    expect(delivered.center.dx, closeTo(195, 1));
    expect(delivered.top, closeTo(295, 2));
    for (var i = 0; i < starCenters.length; i++) {
      expect(starCenters[i], closeTo(84.5 + 51 * i, 1));
    }
    expect(prompt.left, closeTo(24, 1));
    expect(prompt.top, closeTo(483, 2));
    expect(input.left, closeTo(24, 1));
    expect(input.top, closeTo(504, 1));
    expect(input.width, closeTo(342, 1));
    expect(input.height, closeTo(52, 1));
    expect(submit.left, closeTo(24, 1));
    expect(submit.top, closeTo(632, 2));
    expect(submit.width, closeTo(342, 1));
    expect(receipt.left, closeTo(24, 1));
    expect(receipt.top, closeTo(695, 2));
    expect(receipt.width, closeTo(342, 1));
    expect(navigation.top, closeTo(758, 1));
    expect(navigation.height, closeTo(86, 1));
    expect(api.snapshot.eligible, isTrue);
    expect(tester.takeException(), isNull);
  });
}
