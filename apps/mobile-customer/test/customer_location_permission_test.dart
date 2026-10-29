import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/customer_location_permission.dart';
import 'package:bitpos_customer/customer_location_access.dart';

void main() {
  Widget page({
    CustomerLocationStatus status = CustomerLocationStatus.initial,
    bool busy = false,
    required VoidCallback allow,
    required VoidCallback skip,
    required VoidCallback settings,
    required VoidCallback back,
  }) => MaterialApp(
    home: CustomerLocationPermission(
      thai: true,
      busy: busy,
      status: status,
      onAllow: allow,
      onSkip: skip,
      onSettings: settings,
      onBack: back,
    ),
  );

  testWidgets('U04 uses OS-result callbacks without inventing a location', (tester) async {
    var allow = 0;
    var skip = 0;
    var settings = 0;
    var back = 0;
    await tester.pumpWidget(page(
      allow: () => allow++,
      skip: () => skip++,
      settings: () => settings++,
      back: () => back++,
    ));
    expect(find.text('อนุญาตตำแหน่ง'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('customer-location-primary')));
    await tester.tap(find.byKey(const ValueKey('customer-location-skip')));
    await tester.tap(find.byKey(const ValueKey('customer-location-back')));
    expect([allow, skip, settings, back], [1, 1, 0, 1]);

    await tester.pumpWidget(page(
      status: CustomerLocationStatus.permanentlyDenied,
      allow: () => allow++,
      skip: () => skip++,
      settings: () => settings++,
      back: () => back++,
    ));
    expect(find.text('เปิดการตั้งค่า'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('customer-location-primary')));
    expect(settings, 1);
    expect(find.textContaining('BitPOS'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('U04 keeps actions 342px wide at TH390 and bounded on desktop', (tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(page(
      status: CustomerLocationStatus.servicesOff,
      allow: _noop,
      skip: _noop,
      settings: _noop,
      back: _noop,
    ));
    expect(tester.getRect(find.byKey(const ValueKey('customer-location-primary'))).width, 342);
    expect(find.text('เปิดการตั้งค่า'), findsOneWidget);

    await tester.binding.setSurfaceSize(const Size(1280, 900));
    await tester.pumpWidget(page(
      busy: true,
      status: CustomerLocationStatus.error,
      allow: _noop,
      skip: _noop,
      settings: _noop,
      back: _noop,
    ));
    expect(tester.getRect(find.byKey(const ValueKey('customer-location-primary'))).width, 472);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    expect(tester.takeException(), isNull);
  });
}

void _noop() {}
