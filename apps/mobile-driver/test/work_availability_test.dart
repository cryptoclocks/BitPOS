import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/driver_mutation.dart';
import 'package:bitpos_driver/work_availability.dart';
import 'package:bitpos_driver/presentation/driver_presentation.dart';

import 'driver_identity_test.dart' show DriverApi;

class AvailabilityApi extends DriverApi {
  final commands = <DriverMutation>[];
  DriverMutation? saved;
  bool fail = false;
  @override
  Future<DriverMutation?> pendingDriverMutation() async => saved;
  @override
  Future<void> submitDriverMutation(DriverMutation command) async {
    commands.add(command);
    saved = command;
    if (fail) throw StateError('lost acknowledgement');
    await super.submitDriverMutation(command);
    saved = null;
  }
}

void main() {
  Future<void> mount(WidgetTester tester, AvailabilityApi api) async {
    addTearDown(api.close);
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: WorkAvailability(api: api, thai: false),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets(
    'read never renews automatically and deadline disables both controls',
    (tester) async {
      final api = AvailabilityApi();
      await mount(tester, api);
      expect(api.commands, isEmpty);
      expect(
        tester
            .widget<DriverAvailabilityCard>(find.byType(DriverAvailabilityCard))
            .onToggle,
        isNotNull,
      );
      await tester.pump(const Duration(seconds: 3));
      expect(
        tester
            .widget<DriverAvailabilityCard>(find.byType(DriverAvailabilityCard))
            .onToggle,
        isNull,
      );
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Renew availability'),
            )
            .onPressed,
        isNull,
      );
      expect(api.commands, isEmpty);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets(
    'lost response recovers exact saved command before another mutation',
    (tester) async {
      final api = AvailabilityApi()..fail = true;
      await mount(tester, api);
      await tester.tap(find.text('Renew availability'));
      await tester.pumpAndSettle();
      expect(api.commands, hasLength(1));
      expect(
        tester
            .widget<DriverAvailabilityCard>(find.byType(DriverAvailabilityCard))
            .onToggle,
        isNull,
      );
      expect(find.text('Recover saved driver command'), findsOneWidget);
      api.fail = false;
      await tester.tap(find.text('Recover saved driver command'));
      await tester.pumpAndSettle();
      expect(api.commands, hasLength(2));
      expect(identical(api.commands.first, api.commands.last), isTrue);
      expect(api.saved, isNull);
      expect(find.text('Recover saved driver command'), findsNothing);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets(
    'expired documents cannot renew even when snapshot says verified',
    (tester) async {
      final api = AvailabilityApi()..expired = true;
      await mount(tester, api);
      expect(
        tester
            .widget<OutlinedButton>(
              find.widgetWithText(OutlinedButton, 'Renew availability'),
            )
            .onPressed,
        isNull,
      );
      expect(api.commands, isEmpty);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets('background hides authority until resumed canonical refresh', (
    tester,
  ) async {
    final api = AvailabilityApi();
    await mount(tester, api);
    expect(find.text('Online according to server'), findsOneWidget);
    final dynamic state = tester.state(find.byType(WorkAvailability));
    state.didChangeAppLifecycleState(AppLifecycleState.paused);
    await tester.pump();
    expect(find.text('Online according to server'), findsNothing);
    expect(
      tester
          .widget<DriverAvailabilityCard>(find.byType(DriverAvailabilityCard))
          .onToggle,
      isNull,
    );
    api.online = false;
    state.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await tester.pumpAndSettle();
    expect(find.text('Offline according to server'), findsOneWidget);
    expect(api.commands, isEmpty);
    await tester.pumpWidget(const MaterialApp());
  });
}
