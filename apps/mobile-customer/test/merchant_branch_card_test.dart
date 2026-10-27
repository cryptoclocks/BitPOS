import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/merchant_branch_card.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

const id = '00000000-0000-4000-8000-000000000041';
void main() {
  testWidgets(
    'card displays real address, fallback name and separate actions at Thai150percent',
    (tester) async {
      tester.view.physicalSize = const Size(320, 1100);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      var opens = 0, favourites = 0;
      final branch = MobileBranch(
        id: id,
        merchantId: id,
        merchantName: 'ร้านเจ้าของ',
        name: 'สาขาทดสอบชื่อยาว',
        nameEn: '',
        addressLabel: 'ที่อยู่สาขาที่ระบบยืนยันไว้',
        pickupEnabled: false,
        deliveryEnabled: true,
        version: 1,
      );
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context)
                .copyWith(textScaler: const TextScaler.linear(1.5)),
            child: child!,
          ),
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.all(24),
              child: MerchantBranchCard(
                branch: branch,
                thai: true,
                onOpen: () => opens++,
                onFavourite: () => favourites++,
              ),
            ),
          ),
        ),
      );
      expect(find.text(branch.addressLabel), findsOneWidget);
      expect(find.text(branch.merchantName), findsOneWidget);
      await tester.tap(find.byTooltip('บันทึกร้านโปรด'));
      expect(favourites, 1);
      expect(opens, 0);
      await tester.tap(find.text(branch.name));
      expect(opens, 1);
      expect(tester.takeException(), isNull);
    },
  );
}
