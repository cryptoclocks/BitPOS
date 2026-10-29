import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/food_work_page.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('actual retained-custody delivery issue report', (tester) async {
    final session = MobileSession.fromJson(
      jsonDecode(
        utf8.decode(
          base64Decode(
            const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'),
          ),
        ),
      ),
    );
    FlutterSecureStorage.setMockInitialValues({
      'bitpos.mobileSession': jsonEncode(session),
      'bitpos.deviceId': '00000000-0000-4000-8000-000000000081',
    });
    final api = MobileApi(
      base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
      fixture: true,
    );
    await api.restore();
    addTearDown(api.close);
    final initial =
        (await api.foodDriverWork()).assignment as FoodDriverAssignment;
    expect(initial.state, 'PICKED_UP');
    await tester.pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: FoodWorkPage(api: api, thai: false),
      ),
    );
    final button = find.byKey(const ValueKey('food-delivery-issue'));
    final deadline = DateTime.now().add(const Duration(seconds: 30));
    while (button.evaluate().isEmpty && DateTime.now().isBefore(deadline)) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    await tester.scrollUntilVisible(button, 350);
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
    expect(find.text('Report a delivery problem'), findsOneWidget);
    expect(find.byType(DropdownButtonFormField<String>), findsNothing);
    await tester.enterText(
      find.byKey(const ValueKey('food-incident-body')),
      'AVD synthetic delivery issue: recipient unavailable, staff assistance requested',
    );
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('food-incident-send')));
    await tester.pump();
    final confirmed = find.byKey(const ValueKey('food-incident-confirmed'));
    final end = DateTime.now().add(const Duration(seconds: 30));
    while (confirmed.evaluate().isEmpty && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
    }
    expect(confirmed, findsOneWidget);
    expect(await api.pendingFoodDispatch(), isNull);
    final duty =
        (await api.foodDriverWork()).assignment
            as FoodDriverRestrictedAssignment;
    expect(duty.id, initial.id);
    expect(duty.reason, 'INCIDENT');
    expect(duty.custodyPhase, 'PICKED_UP');
    final reports = await api.foodIncidents(initial.id);
    expect(reports.incidents.single.kind, 'CUSTODY');
    expect(reports.incidents.single.blocksDuty, true);
    await tester.ensureVisible(confirmed);
    await tester.pumpAndSettle();
    debugPrint('BITPOS_DELIVERY_ISSUE_RECORDED');
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(seconds: 2)),
    );
    expect(tester.takeException(), isNull);
  });
}
