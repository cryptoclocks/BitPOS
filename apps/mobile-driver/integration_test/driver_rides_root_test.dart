import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_driver/presentation/driver_rides_page.dart';

// Explicit local E2E: storage holds a synthetic approved driver; every ride call is real HTTP + SQL.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('approved driver accepts, arrives, starts with the PIN and completes a real trip', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) throw StateError('Local fixture required');
    const pin = String.fromEnvironment('BITPOS_TEST_RIDE_PIN');
    expect(pin, matches(RegExp(r'^\d{4}$')));
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))),
      'bitpos.deviceId': const String.fromEnvironment('BITPOS_TEST_DEVICE_ID'),
    });
    final api = MobileApi(base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')), fixture: true);
    addTearDown(api.close);
    await tester.runAsync(api.restore);
    expect(api.signedIn, isTrue);
    await tester.pumpWidget(MaterialApp(
      theme: BitPosTheme.light(),
      home: DriverRidesPage(gateway: DriverRideGateway.fromApi(api), thai: false),
    ));
    Future<void> wait(Finder finder) async {
      for (var n = 0; n < 300 && finder.evaluate().isEmpty; n++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      }
      expect(finder, findsWidgets, reason: 'Visible UI: ${tester.widgetList<Text>(find.byType(Text)).map((t) => t.data).whereType<String>().take(30).join(' | ')}');
    }

    Future<void> tapKey(Finder finder) async {
      await wait(finder);
      await tester.ensureVisible(finder.first);
      await tester.tap(finder.first);
      await tester.pump();
    }

    await tapKey(find.widgetWithText(FilledButton, 'Accept this trip'));
    await wait(find.byKey(const ValueKey('ride-arrive')));
    await tapKey(find.byKey(const ValueKey('ride-arrive')));
    await wait(find.byKey(const ValueKey('ride-pin-field')));
    await tester.enterText(find.byKey(const ValueKey('ride-pin-field')), '0000' == pin ? '1111' : '0000');
    await tester.pump();
    await tapKey(find.byKey(const ValueKey('ride-start')));
    await wait(find.byKey(const ValueKey('ride-error')));
    expect(find.textContaining('Wrong PIN'), findsOneWidget, reason: 'a wrong PIN is refused by the server');
    await tester.enterText(find.byKey(const ValueKey('ride-pin-field')), pin);
    await tester.pump();
    await tapKey(find.byKey(const ValueKey('ride-start')));
    await wait(find.byKey(const ValueKey('ride-complete')));
    expect(find.byKey(const ValueKey('ride-cancel')), findsNothing);
    await tapKey(find.byKey(const ValueKey('ride-complete')));
    await wait(find.byKey(const ValueKey('ride-empty')));
    debugPrint('BITPOS_RIDE_DRIVER_DONE');
    expect(tester.takeException(), isNull);
  });
}
