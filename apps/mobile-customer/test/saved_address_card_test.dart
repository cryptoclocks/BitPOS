import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/presentation/saved_address_card.dart';

void main() {
  testWidgets('Thai address retains private fields and independent actions at narrow large text', (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 1100));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var edits = 0, removes = 0;
    final value = MobileAddress(id: '10000000-0000-4000-8000-000000000001', version: '1',
      archived: false, updatedAt: '2026-10-20T00:00:00Z', address: MobileAddressFields(
        label: 'บ้านสำหรับทดสอบ', recipientName: 'ผู้รับทดสอบ', phone: '+66900000001',
        addressText: '123 ถนนตัวอย่าง กรุงเทพมหานคร', instructions: 'ฝากที่จุดรับอาหารชั้นหนึ่ง', latitudeE7: null, longitudeE7: null));
    await tester.pumpWidget(MaterialApp(home: MediaQuery(data: const MediaQueryData(textScaler: TextScaler.linear(1.5)),
      child: Scaffold(body: SingleChildScrollView(child: Padding(padding: const EdgeInsets.all(24),
        child: SavedAddressCard(address: value, thai: true, onEdit: () => edits++, onRemove: () => removes++)))))));
    expect(find.text(value.address.addressText), findsOneWidget);
    expect(find.text(value.address.instructions), findsOneWidget);
    await tester.tap(find.text('แก้ไข'));
    await tester.tap(find.text('ลบที่อยู่ที่บันทึก'));
    expect(edits, 1); expect(removes, 1);
    expect(tester.takeException(), isNull);
  });
}
