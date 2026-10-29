import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_driver/presentation/driver_application_flow.dart';
void main() {
  testWidgets('application flow exposes truthful staged identity vehicle and review states', (
    tester,
  ) async {
    var stage = DriverApplicationStage.identity;
    Future<void> pump() => tester.pumpWidget(
      MaterialApp(
        home: StatefulBuilder(
          builder: (context, setState) => Scaffold(
            body: DriverApplicationFlow(
              thai: false,
              stage: stage,
              editable: true,
              identityFields: const [Text('Display name')],
              vehicleFields: const [Text('Vehicle plate')],
              verificationStatus: 'Awaiting verification',
              decisionReason: '',
              verifiedUntil: null,
              onBack: stage == DriverApplicationStage.identity
                  ? null
                  : () => setState(() => stage = stage.previous),
              onNext: () => setState(() => stage = stage.next),
              onSubmit: () {},
            ),
          ),
        ),
      ),
    );

    await pump();
    expect(find.text('Confirm your identity'), findsNWidgets(2));
    expect(find.text('Display name'), findsOneWidget);
    expect(
      find.text('Document upload is unavailable in this app. Entering dates is not document submission or approval.'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const ValueKey('driver-application-next')));
    await tester.pumpAndSettle();
    expect(find.text('Your vehicle details'), findsNWidgets(2));
    expect(find.text('Vehicle plate'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('driver-application-next')));
    await tester.pumpAndSettle();
    expect(find.text('Review application status'), findsOneWidget);
    expect(find.text('Awaiting verification'), findsOneWidget);
    expect(
      find.text('Document upload and verifier review are unavailable in this app.'),
      findsOneWidget,
    );
  });

  testWidgets('application controls preserve R03 mobile inset and touch geometry', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: DriverApplicationFlow(
              thai: true,
              stage: DriverApplicationStage.identity,
              editable: true,
              identityFields: const [Text('ชื่อ–นามสกุล')],
              vehicleFields: const [],
              verificationStatus: '',
              decisionReason: '',
              verifiedUntil: null,
              onNext: () {},
              onSubmit: () {},
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    final action = tester.getRect(
      find.byKey(const ValueKey('driver-application-next')),
    );
    expect(action.left, 24);
    expect(action.right, 366);
    expect(action.height, 52);
  });

  testWidgets('application flow captures bilingual mobile and desktop states', (
    tester,
  ) async {
    final captureDirectory = Platform.environment['BITPOS_RIDER_CAPTURE_DIR'];
    if (captureDirectory == null) return;
    final directory = Directory(captureDirectory);
    expect(await directory.exists(), isTrue);

    for (final width in [390.0, 1440.0]) {
      for (final thai in [true, false]) {
        for (final stage in DriverApplicationStage.values) {
          await tester.binding.setSurfaceSize(Size(width, 844));
          final boundary = GlobalKey();
          await tester.pumpWidget(
            MaterialApp(
              theme: ThemeData(
                colorSchemeSeed: const Color(0xff64188a),
                scaffoldBackgroundColor: const Color(0xfff8f5fc),
              ),
              home: Scaffold(
                body: RepaintBoundary(
                  key: boundary,
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 520),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: DriverApplicationFlow(
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
          expect(tester.getRect(action).height, 52);
          final name =
              'R0${stage.index + 3}-${thai ? 'th' : 'en'}-${width.toInt()}';
          final actionRect = tester.getRect(action);
          await tester.runAsync(() async {
            final image =
                await (boundary.currentContext!.findRenderObject()
                        as RenderRepaintBoundary)
                    .toImage(pixelRatio: 1);
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            await File('${directory.path}/$name.png').writeAsBytes(
              bytes!.buffer.asUint8List(),
            );
            await File('${directory.path}/$name.json').writeAsString(
              jsonEncode({
                'screen': 'R0${stage.index + 3}',
                'locale': thai ? 'th' : 'en',
                'viewport': [width, 844],
                'action': [
                  actionRect.left,
                  actionRect.top,
                  actionRect.width,
                  actionRect.height,
                ],
              }),
            );
            image.dispose();
          });
        }
      }
    }
    await tester.binding.setSurfaceSize(null);
  });
}
