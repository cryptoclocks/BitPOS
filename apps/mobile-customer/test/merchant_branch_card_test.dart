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
        openNow: null,
        nextOpenAt: null,
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

  MobileBranch withHours({bool? openNow, String? nextOpenAt}) => MobileBranch(
    id: id,
    merchantId: id,
    merchantName: 'ร้านเจ้าของ',
    name: 'สาขาเวลา',
    nameEn: '',
    addressLabel: 'ที่อยู่',
    pickupEnabled: true,
    deliveryEnabled: false,
    version: 1,
    openNow: openNow,
    nextOpenAt: nextOpenAt,
  );

  testWidgets('closed branch shows chip and keeps opening actionable', (
    tester,
  ) async {
    var opens = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MerchantBranchCard(
            branch: withHours(
              openNow: false,
              nextOpenAt: '2026-11-02T01:00:00Z',
            ),
            thai: true,
            onOpen: () => opens++,
          ),
        ),
      ),
    );
    expect(find.byKey(const ValueKey('branch-closed-chip')), findsOneWidget);
    expect(find.text('ร้านปิดอยู่'), findsOneWidget);
    await tester.tap(find.text('สาขาเวลา'));
    expect(opens, 1, reason: 'closed state must not block browsing or cart');
  });

  testWidgets('open and unknown-hours branches show no closed chip', (
    tester,
  ) async {
    for (final open in [true, null]) {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MerchantBranchCard(
              branch: withHours(openNow: open),
              thai: false,
            ),
          ),
        ),
      );
      expect(find.byKey(const ValueKey('branch-closed-chip')), findsNothing);
    }
  });

  test('closed message uses server next-open and keeps cart wording', () {
    final closed = withHours(
      openNow: false,
      nextOpenAt: '2026-11-02T01:00:00Z',
    );
    expect(branchClosedMessage(closed, false), contains('Your cart is kept'));
    expect(branchClosedMessage(closed, true), contains('ตะกร้าของคุณยังอยู่'));
    expect(branchClosedMessage(closed, true), contains('น.'));
    expect(
      branchClosedMessage(withHours(openNow: false), false),
      'Your cart is kept.',
    );
    expect(branchClosedMessage(withHours(openNow: true), false), isNull);
    expect(branchClosedMessage(withHours(openNow: null), false), isNull);
  });
}
