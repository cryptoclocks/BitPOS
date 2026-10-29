import 'package:bitpos_driver/presentation/driver_job_details_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

FoodDriverAssignment _assignment({bool thai = false, bool instructions = true}) {
  return FoodDriverAssignment(
    id: '12345678-1234-4234-8234-123456789abc',
    shipmentId: '23456789-1234-4234-8234-123456789abc',
    orderId: 'abcdef12-1234-4234-8234-123456789abc',
    merchantId: '34567890-1234-4234-8234-123456789abc',
    generation: '1',
    leaseGeneration: '1',
    shipmentVersion: '1',
    access: 'NORMAL',
    state: 'ACCEPTED',
    pickupLatitudeE7: -137560001,
    pickupLongitudeE7: 1005018001,
    pickupName: 'Try Cafe fixture branch',
    pickupAddress: 'Fixture road, Bangkok (synthetic)',
    items: [FoodDriverPickupItem(name: 'Iced latte', qty: 2)],
    recipientName: thai
        ? 'ผู้รับอาหารที่อาคารสำนักงานทางเข้าด้านหลัง'
        : 'Recipient at the rear office building entrance',
    phone: '+66900000001',
    addressText: List.filled(
      5,
      thai
          ? 'อาคารสำนักงานชั้นสอง เข้าทางประตูด้านหลังใกล้จุดประชาสัมพันธ์'
          : 'Second floor office, rear entrance near the reception desk',
    ).join(' '),
    instructions: !instructions
        ? ''
        : thai
        ? 'กรุณาฝากที่ประชาสัมพันธ์และแจ้งชื่อผู้รับก่อนส่งมอบอาหาร'
        : 'Please leave with reception and confirm the recipient before handover.',
    latitudeE7: 137560000,
    longitudeE7: 1005018000,
    earning: MobileMoney(currency: 'THB', decimals: 2, amountMinor: '12345'),
    fixture: true,
    proofs: [],
  );
}

Widget _surface(FoodDriverAssignment assignment, {bool thai = false}) {
  return MaterialApp(
    home: Scaffold(
      body: MediaQuery(
        data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: DriverJobDetailsCard(assignment: assignment, thai: thai),
        ),
      ),
    ),
  );
}

void main() {
  for (final thai in [false, true]) {
    testWidgets('normal assignment renders truthful long details at 320 $thai', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final assignment = _assignment(thai: thai);
      await tester.pumpWidget(_surface(assignment, thai: thai));
      expect(find.text(assignment.recipientName), findsOneWidget);
      expect(find.text(assignment.addressText), findsOneWidget);
      expect(find.text(assignment.instructions), findsOneWidget);
      expect(find.text('-13.7560001, 100.5018001'), findsOneWidget);
      expect(find.text(assignment.phone), findsOneWidget);
      await tester.drag(find.byType(SingleChildScrollView), const Offset(0, -1800));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }

}
