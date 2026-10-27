import 'package:latlong2/latlong.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/address_pin_page.dart';
import 'package:flutter_map/flutter_map.dart';

void main() {
  testWidgets('configured map center is returned as selected E7 location', (
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
              child: const Text('Open configured map'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Open configured map'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    final map = tester.widget<FlutterMap>(find.byType(FlutterMap));
    map.mapController!.move(const LatLng(-33.8688, 151.2093), 16);
    await tester.pump();
    await tester.tap(find.text('Use this location'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(result, (-338688000, 1512093000));
    await tester.pumpAndSettle();
    expect(find.byType(AddressPinPage), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  }, skip: const String.fromEnvironment('BITPOS_MAP_TILE_URL').isEmpty);

  for (final coordinates in [
    ('-90', '-180', -900000000, -1800000000),
    ('-0.0000001', '179.9999999', -1, 1799999999),
  ]) {
    testWidgets(
      'manual pin keyboard submits exact signed E7 ${coordinates.$1}',
      (tester) async {
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
                  child: const Text('Open'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Open'));
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byKey(const ValueKey('address-pin-latitude')),
          coordinates.$1,
        );
        await tester.testTextInput.receiveAction(TextInputAction.next);
        await tester.pump();
        await tester.enterText(
          find.byKey(const ValueKey('address-pin-longitude')),
          coordinates.$2,
        );
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        expect(result, (coordinates.$3, coordinates.$4));
        expect(tester.takeException(), isNull);
      },
      skip: const String.fromEnvironment('BITPOS_MAP_TILE_URL').isNotEmpty,
    );
  }

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
    expect(
      tester
          .widget<EditableText>(
            find.descendant(
              of: find.byKey(const ValueKey('address-pin-latitude')),
              matching: find.byType(EditableText),
            ),
          )
          .focusNode
          .hasFocus,
      isTrue,
    );
    expect(
      tester
          .widget<TextFormField>(
            find.byKey(const ValueKey('address-pin-longitude')),
          )
          .controller!
          .text,
      '100.5',
    );

    await tester.enterText(
      find.byKey(const ValueKey('address-pin-latitude')),
      '13.7563',
    );
    await tester.enterText(
      find.byKey(const ValueKey('address-pin-longitude')),
      '181',
    );
    await tester.tap(find.text('Use this location'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<EditableText>(
            find.descendant(
              of: find.byKey(const ValueKey('address-pin-longitude')),
              matching: find.byType(EditableText),
            ),
          )
          .focusNode
          .hasFocus,
      isTrue,
    );
    expect(result, isNull);
    await tester.enterText(
      find.byKey(const ValueKey('address-pin-longitude')),
      '100.5018',
    );
    await tester.tap(find.text('Use this location'));
    await tester.pumpAndSettle();
    expect(result, (137563000, 1005018000));
  }, skip: const String.fromEnvironment('BITPOS_MAP_TILE_URL').isNotEmpty);
}
