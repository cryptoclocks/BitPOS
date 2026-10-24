import 'package:bitpos_customer/delivery_address_picker_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

MobileAddress address(int suffix, {required String label}) => MobileAddress(
  id: 'bb000000-0000-4000-8000-${suffix.toString().padLeft(12, '0')}',
  version: '1',
  archived: false,
  updatedAt: '2026-10-20T00:00:00Z',
  address: MobileAddressFields(
    label: label,
    recipientName: 'Fixture customer',
    phone: '+66812345678',
    addressText: 'สุขุมวิท $suffix',
    instructions: '',
    latitudeE7: 137300000,
    longitudeE7: 1005600000,
  ),
);

void main() {
  testWidgets('U12 returns only an eligible server address', (tester) async {
    final eligible = address(1, label: 'Home');
    final outside = address(2, label: 'Office');
    MobileAddress? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                selected = await Navigator.of(context).push<MobileAddress>(
                  MaterialPageRoute(
                    builder: (_) => DeliveryAddressPickerPage(
                      addresses: [eligible, outside],
                      selected: null,
                      thai: false,
                      isEligible: (value) => value.id == eligible.id,
                      onAddAddress: () async => [eligible, outside],
                      hasMore: () => false,
                      onLoadMore: () async => [eligible, outside],
                      onNavigate: (_) async {},
                    ),
                  ),
                );
              },
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
    expect(find.text('Delivery addresses'), findsOneWidget);
    expect(
      find.text('Outside delivery area or missing coordinates'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(ValueKey('delivery-address-${outside.id}')));
    await tester.pumpAndSettle();
    expect(find.text('Delivery addresses'), findsOneWidget);
    await tester.tap(find.byKey(ValueKey('delivery-address-${eligible.id}')));
    await tester.pumpAndSettle();
    expect(selected?.id, eligible.id);
  });

  testWidgets('U12 refreshes addresses after opening account address editor', (
    tester,
  ) async {
    final existing = address(3, label: 'Home');
    final added = address(4, label: 'Office');
    await tester.pumpWidget(
      MaterialApp(
        home: DeliveryAddressPickerPage(
          addresses: [existing],
          selected: existing,
          thai: false,
          isEligible: (_) => true,
          onAddAddress: () async => [existing, added],
          hasMore: () => false,
          onLoadMore: () async => [existing, added],
          onNavigate: (_) async {},
        ),
      ),
    );
    await tester.tap(find.text('Add a new address'));
    await tester.pumpAndSettle();
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Office'), findsOneWidget);
    expect(find.text('Delivery addresses'), findsOneWidget);
  });

  testWidgets('U12 appends the next server address page', (tester) async {
    final home = address(5, label: 'Home');
    final office = address(6, label: 'Office');
    var more = true;
    await tester.pumpWidget(
      MaterialApp(
        home: DeliveryAddressPickerPage(
          addresses: [home],
          selected: null,
          thai: false,
          isEligible: (_) => true,
          onAddAddress: () async => [home, office],
          hasMore: () => more,
          onLoadMore: () async {
            more = false;
            return [home, office];
          },
          onNavigate: (_) async {},
        ),
      ),
    );
    expect(find.text('Load more addresses'), findsOneWidget);
    await tester.tap(find.text('Load more addresses'));
    await tester.pumpAndSettle();
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Office'), findsOneWidget);
    expect(find.text('Load more addresses'), findsNothing);
  });
}
