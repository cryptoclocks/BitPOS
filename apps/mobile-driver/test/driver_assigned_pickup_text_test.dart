import 'package:bitpos_driver/presentation/driver_assigned_navigation_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

FoodDriverAssignment _job(String state, {String address = 'Fixture road, Bangkok'}) =>
    FoodDriverAssignment(
      id: '12345678-1234-4234-8234-123456789abc',
      shipmentId: '23456789-1234-4234-8234-123456789abc',
      orderId: 'abcdef12-1234-4234-8234-123456789abc',
      merchantId: '34567890-1234-4234-8234-123456789abc',
      generation: '1',
      leaseGeneration: '1',
      shipmentVersion: '1',
      access: 'NORMAL',
      state: state,
      pickupLatitudeE7: 137560000,
      pickupLongitudeE7: 1005018000,
      pickupName: 'Try Cafe',
      pickupAddress: address,
      items: [FoodDriverPickupItem(name: 'Latte', qty: 2), FoodDriverPickupItem(name: 'Croissant', qty: 1)],
      recipientName: 'Rec',
      phone: '+66900000001',
      addressText: 'Customer address 9',
      instructions: '',
      latitudeE7: 137560001,
      longitudeE7: 1005018001,
      earning: MobileMoney(currency: 'THB', decimals: 2, amountMinor: '100'),
      fixture: true,
      proofs: [],
    );

Widget _card(FoodDriverAssignment a, bool thai) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: DriverAssignedNavigationCard(
        assignment: a,
        thai: thai,
        status: 's',
        mapBuilder: (h, inset, compose) => Builder(
          builder: (context) => compose(context, SizedBox(height: h), const SizedBox(), null, const SizedBox()),
        ),
        onViewMap: () {},
        onChat: () {},
        onArrive: () {},
      ),
    ),
  ),
);

void main() {
  for (final thai in [false, true]) {
    testWidgets('pickup stage shows shop name, address and item count (thai=$thai)', (tester) async {
      await tester.pumpWidget(_card(_job('ACCEPTED'), thai));
      final text = tester.widget<Text>(find.byKey(const ValueKey('food-assigned-destination'))).data!;
      expect(text, contains('Try Cafe'));
      expect(text, contains('Fixture road, Bangkok'));
      expect(text, contains(thai ? '3 รายการ' : '3 items'));
      expect(text, isNot(contains('ยังไม่พร้อม')));
    });
  }
  testWidgets('dropoff stage still shows the customer address', (tester) async {
    await tester.pumpWidget(_card(_job('PICKED_UP'), false));
    expect(tester.widget<Text>(find.byKey(const ValueKey('food-assigned-destination'))).data, 'Customer address 9');
  });
}
