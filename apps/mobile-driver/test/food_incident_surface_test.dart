import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:bitpos_driver/food_work_page.dart';

import 'food_realtime_lifecycle_test.dart' as fixture;

class IncidentApi extends fixture.LiveWorkApi {
  ({String accountId, String sessionId})? scope = (
    accountId: 'fixture-account',
    sessionId: 'fixture-session',
  );
  Completer<FoodIncidentPage>? incidentRead;
  @override
  Future<FoodIncidentPage> foodIncidents(
    String assignmentId, {
    String? afterId,
  }) async {
    if (incidentRead != null) return incidentRead!.future;
    final duty = current.assignment!;
    final (id, shipment, generation, lease) = switch (duty) {
      FoodDriverAssignment a => (
        a.id,
        a.shipmentId,
        a.generation,
        a.leaseGeneration,
      ),
      FoodDriverRestrictedAssignment a => (
        a.id,
        a.shipmentId,
        a.generation,
        a.leaseGeneration,
      ),
    };
    return FoodIncidentPage.fromJson({
      'incidents': [
        {
          'incidentId': '00000000-0000-4000-8000-000000000081',
          'assignmentId': id,
          'shipmentId': shipment,
          'generation': generation,
          'leaseGeneration': lease,
          'incidentVersion': '2',
          'kind': 'SOS',
          'custodyPhase': 'AT_PICKUP',
          'blocksDuty': true,
          'reportedAt': '2026-10-18T01:00:00Z',
          'acknowledgedAt': '2026-10-18T01:01:00Z',
          'resolvedAt': null,
          'resolution': null,
        },
      ],
      'nextCursor': null,
    });
  }

  @override
  ({String accountId, String sessionId})? get sessionScope => scope;
  @override
  Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
    if (command is! FoodIncidentMutation)
      return super.submitFoodDispatch(command);
    submitted.add(command);
    final old = current.assignment!;
    final (id, shipment, generation, lease, version, phase) = switch (old) {
      FoodDriverAssignment a => (
        a.id,
        a.shipmentId,
        a.generation,
        a.leaseGeneration,
        a.shipmentVersion,
        'PREPICKUP',
      ),
      FoodDriverRestrictedAssignment a => (
        a.id,
        a.shipmentId,
        a.generation,
        a.leaseGeneration,
        a.shipmentVersion,
        a.custodyPhase,
      ),
    };
    current = FoodDriverWork(
      offers: [],
      assignment: FoodDriverRestrictedAssignment(
        access: 'RESTRICTED',
        id: id,
        shipmentId: shipment,
        generation: generation,
        leaseGeneration: lease,
        shipmentVersion: version,
        custodyPhase: phase,
        reason: 'INCIDENT',
      ),
    );
    read = Completer<FoodDriverWork>();
    return FoodIncidentReceipt.fromJson({
      'incident': {
        'incidentId': '00000000-0000-4000-8000-000000000081',
        'assignmentId': id,
        'shipmentId': shipment,
        'generation': generation,
        'leaseGeneration': lease,
        'incidentVersion': '1',
        'kind': command.command.kind,
        'custodyPhase': 'AT_PICKUP',
        'blocksDuty': true,
        'reportedAt': '2026-10-18T01:00:00Z',
        'acknowledgedAt': null,
        'resolvedAt': null,
        'resolution': null,
      },
      'shipmentVersion': version,
      'paused': true,
    });
  }
}

class AmbiguousIncidentApi extends IncidentApi {
  AmbiguousIncidentApi(this.failure);
  final String failure;
  FoodDispatchMutation? saved;
  bool ambiguous = true;
  @override
  Future<FoodDispatchMutation?> pendingFoodDispatch() async => saved;
  @override
  Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
    final result = await super.submitFoodDispatch(command);
    if (ambiguous) {
      saved = command;
      if (failure == 'FORMAT')
        throw const FormatException('Mismatched fixture receipt');
      throw MobileApiException(failure, 503);
    }
    saved = null;
    return result;
  }
}

Future<void> openReport(WidgetTester tester) async {
  final button = find.byKey(const ValueKey('food-report-incident'));
  await tester.scrollUntilVisible(button, 400);
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  await tester.tap(button);
  await tester.pumpAndSettle();
  expect(find.byType(AlertDialog), findsOneWidget);
}

Future<void> privateDutyAbsent(WidgetTester tester, String name) async {
  final position = tester
      .state<ScrollableState>(
        find
            .descendant(
              of: find.byType(ListView).first,
              matching: find.byType(Scrollable),
            )
            .first,
      )
      .position;
  position.jumpTo(0);
  await tester.pump();
  while (true) {
    expect(find.text(name), findsNothing);
    expect(find.text('Allow and start assignment GPS'), findsNothing);
    if (position.pixels >= position.maxScrollExtent) break;
    position.jumpTo((position.pixels + 250).clamp(0, position.maxScrollExtent));
    await tester.pump();
  }
}

void main() {
  late GeolocatorPlatform previous;
  late fixture.ActiveNative native;
  setUp(() {
    previous = GeolocatorPlatform.instance;
    native = fixture.ActiveNative();
    GeolocatorPlatform.instance = native;
  });
  tearDown(() {
    native.close();
    GeolocatorPlatform.instance = previous;
  });
  testWidgets(
    'postpickup delivery issue explicitly submits blocking custody report',
    (tester) async {
      final api = IncidentApi();
      addTearDown(api.close);
      final normal = api.current.assignment as FoodDriverAssignment;
      api.current = FoodDriverWork(
        offers: [],
        assignment: FoodDriverAssignment.fromJson({
          ...normal.toJson(),
          'state': 'AT_DROPOFF',
          'proofs': [],
        }),
      );
      await fixture.mount(tester, api);
      final button = find.byKey(const ValueKey('food-delivery-issue'));
      await tester.scrollUntilVisible(button, 350);
      await tester.ensureVisible(button);
      await tester.pumpAndSettle();
      await tester.tap(button);
      await tester.pumpAndSettle();
      expect(find.text('Report a delivery problem'), findsOneWidget);
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const ValueKey('food-incident-send')),
            )
            .onPressed,
        isNull,
      );
      await tester.enterText(
        find.byKey(const ValueKey('food-incident-body')),
        'Cannot reach the recipient; please assist',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('food-incident-send')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        api.submitted.single,
        isA<FoodIncidentMutation>().having(
          (command) => command.command.kind,
          'kind',
          'CUSTODY',
        ),
      );
      final authoritative = api.current;
      api.read!.complete(authoritative);
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('food-delivery-issue')), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'paused incident receipt retires private pickup before delayed authoritative recovery',
    (tester) async {
      final api = IncidentApi()
        ..current = fixture.work(name: 'Private incident recipient');
      addTearDown(api.close);
      final old = api.current;
      await fixture.mount(tester, api);
      await openReport(tester);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Urgent safety concern').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey('food-incident-body')),
        'Private synthetic safety detail',
      );
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('food-incident-send')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        api.submitted.single,
        isA<FoodIncidentMutation>().having(
          (value) => value.command.kind,
          'kind',
          'SOS',
        ),
      );
      expect(find.text('Private incident recipient'), findsNothing);
      expect(find.byType(AlertDialog), findsNothing);
      final authoritative = api.current;
      api.publish(old);
      await tester.pump();
      expect(find.text('Private incident recipient'), findsNothing);
      api.read!.complete(authoritative);
      await tester.pumpAndSettle();
      await tester.drag(find.byType(ListView).first, const Offset(0, 2000));
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('food-incident-confirmed')),
        findsOneWidget,
      );
      expect(find.text('Private incident recipient'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'acknowledged report history does not present retained duty as resumed',
    (tester) async {
      final api = IncidentApi()
        ..current = FoodDriverWork(
          offers: [],
          assignment: FoodDriverRestrictedAssignment(
            access: 'RESTRICTED',
            id: '00000000-0000-4000-8000-000000000001',
            shipmentId: '00000000-0000-4000-8000-000000000002',
            generation: '1',
            leaseGeneration: '1',
            shipmentVersion: '4',
            custodyPhase: 'PICKED_UP',
            reason: 'INCIDENT',
          ),
        );
      addTearDown(api.close);
      await fixture.mount(tester, api);
      final history = find.byKey(const ValueKey('food-incident-history'));
      await tester.scrollUntilVisible(
        history,
        400,
        scrollable: find
            .descendant(
              of: find.byType(ListView).first,
              matching: find.byType(Scrollable),
            )
            .first,
      );
      await tester.ensureVisible(history);
      await tester.pumpAndSettle();
      await tester.tap(history);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(
        find.text('Acknowledged; not authorization to resume'),
        findsOneWidget,
      );
      expect(native.positions.hasListener, false);
      expect(api.submitted, isEmpty);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'restored pending safety journal fences stale initial read and realtime work',
    (tester) async {
      final api = AmbiguousIncidentApi('NETWORK_UNAVAILABLE')
        ..current = fixture.work(name: 'Private restored recipient');
      addTearDown(api.close);
      final stale = api.current;
      api.saved = api.reportFoodIncidentCommand(
        stale.assignment!,
        kind: 'SOS',
        body: 'Private restored synthetic report',
      );
      api.read = Completer<FoodDriverWork>();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpWidget(
        MaterialApp(home: FoodWorkPage(api: api, thai: false)),
      );
      await tester.pump();
      api.publish(stale);
      await tester.pump();
      await privateDutyAbsent(tester, 'Private restored recipient');
      api.read!.complete(stale);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await privateDutyAbsent(tester, 'Private restored recipient');
      expect(native.positions.hasListener, false);
    },
  );
  for (final failure in ['NETWORK_UNAVAILABLE', 'TIMEOUT', 'FORMAT']) {
    testWidgets(
      'ambiguous $failure safety report retires private duty before SSE recovery',
      (tester) async {
        final api = AmbiguousIncidentApi(failure)
          ..current = fixture.work(name: 'Private ambiguous recipient');
        addTearDown(api.close);
        final old = api.current;
        await fixture.mount(tester, api);
        await openReport(tester);
        await tester.enterText(
          find.byKey(const ValueKey('food-incident-body')),
          'Private synthetic ambiguous report',
        );
        await tester.pump();
        await tester.tap(find.byKey(const ValueKey('food-incident-send')));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(api.saved, isA<FoodIncidentMutation>());
        await privateDutyAbsent(tester, 'Private ambiguous recipient');
        final restricted = api.current;
        api.publish(old);
        await tester.pump();
        await privateDutyAbsent(tester, 'Private ambiguous recipient');
        expect(native.positions.hasListener, false);
        api.current = restricted;
        api.ambiguous = false;
        final position = tester
            .state<ScrollableState>(
              find
                  .descendant(
                    of: find.byType(ListView).first,
                    matching: find.byType(Scrollable),
                  )
                  .first,
            )
            .position;
        position.jumpTo(0);
        await tester.pump();
        final recover = find.text('Recover same command');
        await tester.ensureVisible(recover);
        await tester.pump();
        await tester.tap(recover);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        api.read!.complete(api.current);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        expect(api.saved, isNull);
        await privateDutyAbsent(tester, 'Private ambiguous recipient');
        expect(native.positions.hasListener, false);
        api.read = null;
        api.publish(old);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 300));
        position.jumpTo(0);
        await tester.pump();
        await tester.scrollUntilVisible(
          find.text('Private ambiguous recipient'),
          250,
        );
        expect(find.text('Private ambiguous recipient'), findsOneWidget);
        expect(native.positions.hasListener, false);
      },
    );
  }
  for (final transition in ['background', 'disconnect', 'session-switch']) {
    testWidgets('private incident editor cannot submit across $transition', (
      tester,
    ) async {
      final api = IncidentApi();
      addTearDown(api.close);
      await fixture.mount(tester, api);
      await openReport(tester);
      await tester.enterText(
        find.byKey(const ValueKey('food-incident-body')),
        'Private unsent incident',
      );
      await tester.pump();
      if (transition == 'background') {
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.inactive,
        );
      }
      if (transition == 'disconnect') {
        api.updates.add(
          const FoodRealtimeDisconnected(
            MobileApiException('REALTIME_DISCONNECTED', 503),
          ),
        );
      }
      if (transition == 'session-switch') {
        api.scope = (
          accountId: 'another-fixture-account',
          sessionId: 'another-fixture-session',
        );
        await tester.tap(find.byKey(const ValueKey('food-incident-send')));
      }
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Private unsent incident'), findsNothing);
      expect(api.submitted, isEmpty);
      expect(tester.takeException(), isNull);
    });
  }
}
