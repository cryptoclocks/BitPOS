import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/address_pin_page.dart';
import 'package:flutter_map/flutter_map.dart';

void main() {
  testWidgets('configured tile source renders a map with attribution', (
    tester,
  ) async {
    const tileUrl = String.fromEnvironment('BITPOS_MAP_TILE_URL');
    const attribution = String.fromEnvironment('BITPOS_MAP_ATTRIBUTION');
    await tester.pumpWidget(
      const MaterialApp(home: AddressPinPage(thai: false)),
    );

    if (tileUrl.isEmpty || attribution.isEmpty) {
      expect(find.text('Map is unavailable'), findsOneWidget);
      return;
    }
    expect(find.byType(FlutterMap), findsOneWidget);
    expect(find.text(attribution), findsOneWidget);
    expect(find.byIcon(Icons.location_pin), findsOneWidget);
  });

  testWidgets('pin route validates manual coordinates and returns E7 values', (
    tester,
  ) async {
    (int?, int?)? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                result = await Navigator.of(context).push<(int?, int?)>(
                  MaterialPageRoute(
                    builder: (_) => const AddressPinPage(thai: false),
                  ),
                );
              },
              child: const Text('Open map'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open map'));
    await tester.pumpAndSettle();
    expect(find.text('Map is unavailable'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('address-pin-latitude')),
      '91',
    );
    await tester.enterText(
      find.byKey(const ValueKey('address-pin-longitude')),
      '100.5',
    );
    await tester.tap(find.text('Use this location'));
    await tester.pumpAndSettle();
    expect(find.text('Enter a valid coordinate'), findsOneWidget);
    expect(result, isNull);

    await tester.enterText(
      find.byKey(const ValueKey('address-pin-latitude')),
      '13.7563',
    );
    await tester.enterText(
      find.byKey(const ValueKey('address-pin-longitude')),
      '100.5018',
    );
    await tester.tap(find.text('Use this location'));
    await tester.pumpAndSettle();
    expect(result, (137563000, 1005018000));
  }, skip: const String.fromEnvironment('BITPOS_MAP_TILE_URL').isNotEmpty);
}
