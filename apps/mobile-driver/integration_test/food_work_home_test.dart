import 'dart:convert';

import 'package:http/http.dart' as http;

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/main.dart';
import 'package:bitpos_driver/presentation/driver_work_map_card.dart';
import 'package:bitpos_driver/daily_earnings_summary.dart';
import 'package:bitpos_driver/driver_rating_summary.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'actual root work overview shows owned facts and offers shortcut without GPS action',
    (tester) async {
      if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
        throw StateError('Local fixture required');
      }
      final session = jsonDecode(
        utf8.decode(
          base64Decode(
            const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'),
          ),
        ),
      );
      FlutterSecureStorage.setMockInitialValues({
        'bitpos.mobileSession': jsonEncode(session),
        'bitpos.deviceId': const String.fromEnvironment(
          'BITPOS_TEST_DEVICE_ID',
        ),
      });
      final api = MobileApi(
        base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
        fixture: true,
      );
      addTearDown(api.close);
      await tester.runAsync(api.restore);
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: BitPosTheme.light(),
          home: DriverSessionPage(api: api),
        ),
      );
      Future<void> ready(bool Function() check) async {
        for (var n = 0; n < 200 && !check(); n++) {
          await tester.pump();
          await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 100)),
          );
        }
        expect(check(), isTrue);
      }

      await ready(() => find.text('English').evaluate().isNotEmpty);
      await tester.tap(find.text('English'));
      await tester.pump();
      await ready(
        () =>
            find.text('Work').evaluate().isNotEmpty &&
            find.byType(NavigationBar).evaluate().isNotEmpty &&
            tester
                    .widget<NavigationBar>(find.byType(NavigationBar))
                    .onDestinationSelected !=
                null,
      );
      await tester.tap(find.text('Work'));
      await tester.pump();
      await ready(() => find.byType(DriverWorkMapCard).evaluate().isNotEmpty);
      expect(find.text('Map unavailable'), findsOneWidget);
      expect(find.text('Not capturing location'), findsWidgets);
      await tester.scrollUntilVisible(
        find.byType(DriverDailySummary),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await ready(
        () => find.text('Completed deliveries').evaluate().isNotEmpty,
      );
      await tester.ensureVisible(find.byType(DriverDailySummary));
      await tester.pumpAndSettle();
      debugPrint('BITPOS_DRIVER_WORK_SUMMARY_VISIBLE');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 2)),
      );
      await tester.scrollUntilVisible(
        find.text('Ready for work today'),
        -300,
        scrollable: find.byType(Scrollable).first,
      );
      tester
          .state<ScrollableState>(find.byType(Scrollable).first)
          .position
          .jumpTo(0);
      await tester.pumpAndSettle();
      debugPrint('BITPOS_DRIVER_WORK_HOME_VISIBLE');
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 2)),
      );
      if (const bool.fromEnvironment('BITPOS_TEST_RATING106')) {
        await tester.scrollUntilVisible(
          find.byType(DriverRatingSummary),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await ready(() => find.text('4.0').evaluate().isNotEmpty);
        expect(find.text('From 1 published review'), findsOneWidget);
        await tester.ensureVisible(find.byType(DriverRatingSummary));
        await tester.pumpAndSettle();
        debugPrint('BITPOS_DRIVER_WORK_RATING_VISIBLE');
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 2)),
        );
      }
      await tester.scrollUntilVisible(
        find.text('View your offers'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.ensureVisible(find.text('View your offers'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('View your offers'));
      await tester.pumpAndSettle();
      await ready(
        () => find.text('Offers near you').hitTestable().evaluate().isNotEmpty,
      );
      expect(tester.takeException(), isNull);
      await tester.runAsync(() async {
        try {
          await api.logout();
        } on http.ClientException {
          // A bounded explicit retry of this-session logout, never work/money.
          debugPrint('BITPOS_DRIVER_LOGOUT_EXACT_RETRY_AFTER_CONNECTION_LOSS');
          try {
            await api.logout();
          } on MobileApiException catch (error) {
            if (error.status != 401 || api.signedIn) rethrow;
          }
        }
      });
      await ready(() => find.byType(DriverWorkMapCard).evaluate().isEmpty);
      expect(find.text('Completed deliveries'), findsNothing);
      expect(find.text('4.0'), findsNothing);
    },
  );
}
