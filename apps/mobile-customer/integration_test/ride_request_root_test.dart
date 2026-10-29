import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_customer/ride_request_page.dart';

// Explicit local E2E: storage holds a synthetic rider; every ride call is real HTTP + SQL.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('rider requests, follows and finishes a trip through the real ride screen', (tester) async {
    if (!const bool.fromEnvironment('BITPOS_FIXTURE')) throw StateError('Local fixture required');
    const stage = String.fromEnvironment('BITPOS_TEST_RIDE_STAGE');
    expect(['REQUEST', 'VERIFY'], contains(stage));
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
      home: RideRequestPage(gateway: RiderRideGateway.fromApi(api), thai: false, pollInterval: null),
    ));
    Future<void> wait(Finder finder) async {
      for (var n = 0; n < 300 && finder.evaluate().isEmpty; n++) {
        await tester.pump(const Duration(milliseconds: 100));
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 100)));
      }
      expect(finder, findsWidgets, reason: 'Visible UI: ${tester.widgetList<Text>(find.byType(Text)).map((t) => t.data).whereType<String>().take(30).join(' | ')}');
    }

    Future<void> tapKey(String key) async {
      final finder = find.byKey(ValueKey(key));
      await wait(finder);
      await tester.ensureVisible(finder);
      await tester.tap(finder);
      await tester.pump();
    }

    if (stage == 'REQUEST') {
      await wait(find.byKey(const ValueKey('ride-from')));
      await tapKey('ride-from');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ride home').last);
      await tester.pumpAndSettle();
      await tapKey('ride-to');
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ride office').last);
      await tester.pumpAndSettle();
      await tapKey('ride-quote');
      await wait(find.byKey(const ValueKey('ride-quote-fare')));
      debugPrint('BITPOS_RIDE_FARE:${tester.widget<Text>(find.byKey(const ValueKey('ride-quote-fare'))).data}');
      await tapKey('ride-request');
      await wait(find.byKey(const ValueKey('ride-pin')));
      expect(find.text('Looking for a driver'), findsOneWidget);
      debugPrint('BITPOS_RIDE_PIN:${tester.widget<Text>(find.byKey(const ValueKey('ride-pin'))).data}');
    } else {
      await wait(find.byKey(const ValueKey('ride-from')));
      expect(find.byKey(const ValueKey('ride-trip-state')), findsNothing, reason: 'the finished trip is no longer current');
      debugPrint('BITPOS_RIDE_VERIFIED');
    }
    expect(tester.takeException(), isNull);
  });
}
