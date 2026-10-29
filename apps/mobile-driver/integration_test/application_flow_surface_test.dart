// Native local presentation fixture. No API, document upload, verifier, GPS, payment, or database operation.
import 'package:bitpos_driver/presentation/driver_application_flow.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  for (final thai in [true, false]) {
    for (final stage in DriverApplicationStage.values) {
      testWidgets(
        'R0${stage.index + 3} ${thai ? 'TH' : 'EN'} native fixture',
        (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: BitPosTheme.light(),
            home: Scaffold(
              body: SafeArea(
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 520),
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
                      children: [
                        DriverApplicationFlow(
                          thai: thai,
                          stage: stage,
                          editable: true,
                          identityFields: [
                            const TextField(
                              decoration: InputDecoration(labelText: 'ชื่อ–นามสกุล'),
                            ),
                          ],
                          vehicleFields: [
                            const TextField(
                              decoration: InputDecoration(labelText: 'ทะเบียนรถ'),
                            ),
                            const SizedBox(height: 12),
                            const TextField(
                              decoration: InputDecoration(labelText: 'ใบขับขี่หมดอายุ'),
                            ),
                          ],
                          verificationStatus: thai
                              ? 'รอตรวจสอบ'
                              : 'Awaiting verification',
                          decisionReason: thai
                              ? 'ข้อมูลจะตรวจจากเซิร์ฟเวอร์'
                              : 'Status is returned by the server',
                          verifiedUntil: '2030-01-01',
                          onBack: stage == DriverApplicationStage.identity
                              ? null
                              : () {},
                          onNext: () {},
                          onSubmit: () {},
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final action = find.byKey(
          ValueKey(
            stage == DriverApplicationStage.review
                ? 'driver-application-submit'
                : 'driver-application-next',
          ),
        );
        expect(action.hitTestable(), findsOneWidget);
        expect(tester.getRect(action).height, 52);
        debugPrint(
          'BITPOS_RIDER_APPLICATION_R0${stage.index + 3}_${thai ? 'TH' : 'EN'}',
        );
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(seconds: 5)),
        );
        await tester.pumpWidget(const SizedBox.shrink());
        await tester.pumpAndSettle();
        },
      );
    }
  }
}
