import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_navigation_map.dart';

const first = '11111111-1111-4111-8111-111111111111',
    second = '22222222-2222-4222-8222-222222222222';
FoodNavigationSnapshot snapshot(
  String id, {
  bool aged = false,
  int metres = 500,
}) => FoodNavigationSnapshot(
  serverTime: DateTime.now().toUtc().toIso8601String(),
  assignment: FoodNavigationAssignment(
    assignmentId: id,
    generation: '1',
    leaseGeneration: '1',
    shipmentId: id,
    state: 'ACCEPTED',
    fixture: true,
    target: 'PICKUP',
    targetLatitudeE7: 0,
    targetLongitudeE7: 10000,
    location: FoodTrackedLocation(
      sequence: '1',
      latitudeE7: 0,
      longitudeE7: 0,
      accuracyMm: 5000,
      capturedAt: (aged ? DateTime.utc(2000) : DateTime.now())
          .toUtc()
          .toIso8601String(),
      receivedAt: DateTime.now().toUtc().toIso8601String(),
      stale: false,
    ),
  ),
  route: FoodNavigationRoute(
    points: [
      FoodMapPoint(latitudeE7: 0, longitudeE7: 0),
      FoodMapPoint(latitudeE7: 0, longitudeE7: 10000),
    ],
    durationSeconds: 120,
    distanceMetres: metres,
    fixture: true,
    attribution: 'Synthetic fixture route',
  ),
  routeUnavailable: null,
  tilesAvailable: false,
  tileAttribution: null,
  tileFixture: false,
);

class NavigationApi extends MobileApi {
  ({String accountId, String sessionId})? owner = (
    accountId: first,
    sessionId: first,
  );
  final owners =
      StreamController<({String accountId, String sessionId})?>.broadcast(
        sync: true,
      );
  @override
  bool get signedIn => owner != null;
  @override
  ({String accountId, String sessionId})? get sessionScope => owner;
  @override
  Stream<({String accountId, String sessionId})?> get sessionScopes =>
      owners.stream;
  void retire() {
    owner = null;
    owners.add(null);
  }

  @override
  void close() {
    unawaited(owners.close());
    super.close();
  }

  NavigationApi()
    : super(base: Uri.parse('http://localhost/api/mobile/v1/'), fixture: true);
  Object? failure;
  FoodNavigationSnapshot current = snapshot(first);
  final held = <String, Completer<FoodNavigationSnapshot>>{};
  @override
  Future<FoodNavigationSnapshot> foodNavigation({
    String? orderId,
    required String assignmentId,
    required String generation,
    required String leaseGeneration,
  }) => failure != null
      ? Future.error(failure!)
      : held[assignmentId]?.future ?? Future.value(current);
}

Widget surface(NavigationApi api, String id) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: FoodNavigationMap(
        api: api,
        assignmentId: id,
        generation: '1',
        leaseGeneration: '1',
        revision: '1',
        thai: false,
      ),
    ),
  ),
);
void main() {
  for (final reason in [
    'no_assignment',
    'unconfigured',
    'location_unavailable',
    'location_stale',
    'provider_unavailable',
    'invalid_response',
  ]) {
    testWidgets(
      'route reason $reason has bilingual product copy instead of raw code',
      (tester) async {
        final api = NavigationApi();
        addTearDown(api.close);
        api.current = FoodNavigationSnapshot.fromJson({
          ...snapshot(first).toJson(),
          'route': null,
          'routeUnavailable': reason,
        });
        await tester.pumpWidget(surface(api, first));
        await tester.pumpAndSettle();
        expect(find.textContaining(reason), findsNothing);
        expect(find.textContaining('0.5 km'), findsNothing);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: FoodNavigationMap(
                  api: api,
                  assignmentId: first,
                  generation: '1',
                  leaseGeneration: '1',
                  revision: '1',
                  thai: true,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.textContaining(reason), findsNothing);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const MaterialApp());
      },
    );
  }

  for (final failure in [
    const MobileApiException('ASSIGNMENT_CHANGED', 409),
    const MobileApiException('AUTH_REQUIRED', 401),
    TimeoutException('fixture timeout'),
  ]) {
    testWidgets(
      'failed current navigation retires previous private route: $failure',
      (tester) async {
        final api = NavigationApi();
        addTearDown(api.close);
        await tester.pumpWidget(surface(api, first));
        await tester.pumpAndSettle();
        expect(find.textContaining('0.5 km'), findsOneWidget);
        api.failure = failure;
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: FoodNavigationMap(
                  api: api,
                  assignmentId: first,
                  generation: '1',
                  leaseGeneration: '1',
                  revision: '2',
                  thai: false,
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.textContaining('0.5 km'), findsNothing);
        expect(find.textContaining('Location updated'), findsNothing);
        expect(
          find.textContaining('current tracking unconfirmed'),
          findsOneWidget,
        );
        api.failure = null;
        await tester.tap(find.byTooltip('Refresh route'));
        await tester.pumpAndSettle();
        expect(find.textContaining('0.5 km'), findsOneWidget);
        await tester.pumpWidget(const MaterialApp());
      },
    );
  }

  testWidgets(
    'replacing transport retires previous map even with the same account scope',
    (tester) async {
      final firstApi = NavigationApi(), nextApi = NavigationApi();
      addTearDown(firstApi.close);
      addTearDown(nextApi.close);
      await tester.pumpWidget(surface(firstApi, first));
      await tester.pumpAndSettle();
      expect(find.textContaining('0.5 km'), findsOneWidget);
      await tester.pumpWidget(surface(nextApi, first));
      await tester.pumpAndSettle();
      expect(find.textContaining('km'), findsNothing);
      await tester.pumpWidget(const MaterialApp());
    },
  );

  testWidgets(
    'owner retirement clears private route and rejects in-flight old navigation',
    (tester) async {
      final api = NavigationApi();
      addTearDown(api.close);
      await tester.pumpWidget(surface(api, first));
      await tester.pumpAndSettle();
      expect(find.textContaining('0.5 km'), findsOneWidget);
      final held = Completer<FoodNavigationSnapshot>();
      api.held[first] = held;
      await tester.tap(find.byTooltip('Refresh route'));
      await tester.pump();
      api.retire();
      held.complete(snapshot(first, metres: 900));
      await tester.pumpAndSettle();
      expect(find.textContaining('km'), findsNothing);
      expect(find.byType(InteractiveViewer), findsNothing);
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets(
    'background clears private map then resume fetches current route',
    (tester) async {
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      final api = NavigationApi();
      addTearDown(api.close);
      await tester.pumpWidget(surface(api, first));
      await tester.pumpAndSettle();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      tester.binding.scheduleForcedFrame();
      await tester.pump();
      expect(find.textContaining('0.5 km'), findsNothing);
      api.current = snapshot(first, metres: 200);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(find.textContaining('0.2 km'), findsOneWidget);
      await tester.pumpWidget(const MaterialApp());
    },
  );

  testWidgets(
    'aged capture cannot retain a previously available ETA despite fresh receive time',
    (tester) async {
      final api = NavigationApi();
      addTearDown(api.close);
      await tester.pumpWidget(surface(api, first));
      await tester.pumpAndSettle();
      expect(find.textContaining('0.5 km'), findsOneWidget);
      api.current = snapshot(first, aged: true);
      await tester.tap(find.byTooltip('Refresh route'));
      await tester.pumpAndSettle();
      expect(find.textContaining('0.5 km'), findsNothing);
      expect(find.textContaining('STALE'), findsOneWidget);
    },
  );
  testWidgets(
    'old assignment response cannot replace the current assignment route',
    (tester) async {
      final api = NavigationApi(),
          old = Completer<FoodNavigationSnapshot>(),
          current = Completer<FoodNavigationSnapshot>();
      api.held[first] = old;
      api.held[second] = current;
      addTearDown(api.close);
      await tester.pumpWidget(surface(api, first));
      await tester.pump();
      await tester.pumpWidget(surface(api, second));
      await tester.pump();
      current.complete(snapshot(second, metres: 200));
      await tester.pumpAndSettle();
      expect(find.textContaining('0.2 km'), findsOneWidget);
      old.complete(snapshot(first, metres: 900));
      await tester.pumpAndSettle();
      expect(find.textContaining('0.9 km'), findsNothing);
      expect(find.textContaining('0.2 km'), findsOneWidget);
    },
  );
  testWidgets('ETA expires locally when no new navigation response arrives', (
    tester,
  ) async {
    final api = NavigationApi();
    addTearDown(api.close);
    await tester.pumpWidget(surface(api, first));
    await tester.pumpAndSettle();
    expect(find.textContaining('0.5 km'), findsOneWidget);
    await tester.pump(const Duration(seconds: 31));
    expect(find.textContaining('0.5 km'), findsNothing);
    expect(find.textContaining('STALE'), findsOneWidget);
  });
}
