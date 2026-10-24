import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';

import 'dart:async';

import 'driver_earnings_surface_test.dart' show EarningsApi, first, second;

import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/main.dart';
import 'package:bitpos_driver/food_work_page.dart';
import 'food_realtime_lifecycle_test.dart' as work_fixture;

import 'driver_identity_test.dart' show DriverApi;
import 'driver_earnings_surface_test.dart' show page;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_driver/presentation/driver_navigation.dart';
import 'package:geolocator/geolocator.dart';

class NavigationApi extends DriverApi {
  @override
  Future<FoodDriverWork> foodDriverWork() async => work_fixture.work();
  @override
  Stream<FoodRealtimeState<FoodDriverRealtimeSnapshot>> watchFoodWork() =>
      const Stream.empty();
  @override
  Future<FoodDispatchMutation?> pendingFoodDispatch() async => null;
  @override
  Future<FoodChatReadReceipt> markFoodChatRead(
    String assignmentId,
    String lastReadSequence,
  ) async => FoodChatReadReceipt(
    assignmentId: assignmentId,
    lastReadSequence: lastReadSequence,
    updatedAt: '2026-10-20T01:00:00Z',
  );
  @override
  Stream<FoodRealtimeState<FoodChatRealtimeSnapshot>> watchFoodChat(
    String assignmentId,
  ) => const Stream.empty();
  @override
  Future<FoodChatSendCommand?> pendingFoodChatMessage(
    String assignmentId,
  ) async => null;
  @override
  Future<FoodChatPage> foodChat(
    String assignmentId, {
    String afterSequence = '0',
    String? beforeSequence,
  }) async => FoodChatPage(
    assignmentId: assignmentId,
    myRole: 'DRIVER',
    items: [
      FoodChatMessage(
        attachments: const [],
        id: work_fixture.third,
        assignmentId: assignmentId,
        commandId: work_fixture.third,
        sequence: '1',
        senderRole: 'CUSTOMER',
        mine: false,
        body: 'Root chat route fixture',
        createdAt: '2026-10-20T01:00:00Z',
      ),
    ],
    nextAfterSequence: null,
    nextBeforeSequence: null,
    latestSequence: '1',
  );
  @override
  Future<FoodDriverHistory> driverFoodHistory({String? cursor}) async =>
      FoodDriverHistory(items: [], nextCursor: null);
  @override
  Future<SettlementDriverPage> driverEarnings({String? afterId}) async =>
      page(next: null);
}

class RootOwnerApi extends NavigationApi {
  @override
  Future<MobilePushStatus> pushStatus(
    MobilePushApp app,
    String installationKey,
  ) async => MobilePushStatus(installation:MobilePushUnregistered(kind:'UNREGISTERED',revision:'0'),endpointEncryptionAvailable:false);

  ({String accountId, String sessionId})? scope = (
    accountId: first,
    sessionId: first,
  );
  final owners =
      StreamController<({String accountId, String sessionId})?>.broadcast(
        sync: true,
      );
  @override
  get sessionScope => scope;
  @override
  Stream<({String accountId, String sessionId})?> get sessionScopes =>
      owners.stream;
  void replace() {
    scope = (accountId: second, sessionId: second);
    owners.add(scope);
  }

  @override
  void close() {
    unawaited(owners.close());
    super.close();
  }
}

void main() {
  testWidgets(
    'current tab does not stack and changed destination returns once',
    (tester) async {
      int? result;
      bool returned = false;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  result = await Navigator.of(context).push<int>(
                    MaterialPageRoute<int>(
                      builder: (_) => const DriverDestination(
                        index: 1,
                        thai: false,
                        child: Scaffold(body: Text('Owned history')),
                      ),
                    ),
                  );
                  returned = true;
                },
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        1,
      );
      await tester.tap(find.text('History'));
      await tester.pumpAndSettle();
      expect(returned, false);
      expect(find.text('Owned history'), findsOneWidget);
      await tester.tap(find.text('Earnings'));
      await tester.pumpAndSettle();
      expect(returned, true);
      expect(result, 2);
      expect(find.text('Owned history'), findsNothing);
    },
  );
  testWidgets('Thai narrow navigation exposes all four destinations', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    int? selected;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          bottomNavigationBar: DriverNavigation(
            thai: true,
            selectedIndex: 3,
            onSelected: (index) => selected = index,
          ),
        ),
      ),
    );
    for (final label in ['รับงาน', 'ประวัติ', 'รายได้', 'บัญชี']) {
      expect(find.text(label), findsOneWidget);
    }
    await tester.tap(find.text('รับงาน'));
    expect(selected, 0);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'actual root navigates history earnings account without stacking destinations',
    (tester) async {
      final api = NavigationApi();
      addTearDown(api.close);
      await tester.pumpWidget(MaterialApp(home: DriverSessionPage(api: api)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('English'));
      await tester.pump();
      await tester.tap(find.text('History'));
      await tester.pumpAndSettle();
      expect(find.text('No closed deliveries yet.'), findsOneWidget);
      expect(find.byType(DriverDestination), findsOneWidget);
      await tester.tap(find.text('Earnings'));
      await tester.pumpAndSettle();
      expect(find.text('No closed deliveries yet.'), findsNothing);
      expect(find.byType(DriverDestination), findsOneWidget);
      await tester.tap(find.text('Account'));
      await tester.pumpAndSettle();
      expect(find.byType(DriverDestination), findsNothing);
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        3,
      );
      await tester.pumpWidget(const MaterialApp());
    },
  );
  testWidgets(
    'actual rider root replaces work chat with History when rider selects History',
    (tester) async {
      final previous = GeolocatorPlatform.instance,
          native = work_fixture.ActiveNative();
      GeolocatorPlatform.instance = native;
      addTearDown(() {
        native.close();
        GeolocatorPlatform.instance = previous;
      });
      final api = NavigationApi()
        ..expiry = DateTime.now().add(const Duration(hours: 1));
      addTearDown(api.close);
      await tester.pumpWidget(MaterialApp(home: DriverSessionPage(api: api)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('English'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Work'));
      await tester.pumpAndSettle();
      expect(find.byType(FoodWorkPage), findsOneWidget);
      final chat = find.text('Chat with customer');
      await tester.scrollUntilVisible(
        chat,
        300,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.tap(chat);
      await tester.pumpAndSettle();
      expect(find.text('Root chat route fixture'), findsOneWidget);
      await tester.tap(find.text('History'));
      await tester.pumpAndSettle();
      expect(find.text('Root chat route fixture'), findsNothing);
      expect(find.text('No closed deliveries yet.'), findsOneWidget);
      expect(find.byType(DriverDestination), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'destination owner change removes exact route and stale navigation',
    (tester) async {
      final api = EarningsApi();
      addTearDown(api.close);
      int? selected;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () async {
                  selected = await Navigator.of(context).push<int>(
                    MaterialPageRoute<int>(
                      builder: (_) => DriverDestination(
                        api: api,
                        index: 1,
                        thai: false,
                        child: const Text('Private destination'),
                      ),
                    ),
                  );
                },
                child: const Text('Open owner route'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open owner route'));
      await tester.pumpAndSettle();
      api.change(api.owner);
      await tester.pump();
      expect(find.text('Private destination'), findsOneWidget);
      api.change((accountId: first, sessionId: second));
      await tester.pumpAndSettle();
      expect(find.text('Private destination'), findsNothing);
      expect(find.byType(DriverNavigation), findsNothing);
      expect(selected, isNull);
    },
  );
  testWidgets(
    'replacement session clears root profile instead of showing old account',
    (tester) async {
      FlutterSecureStorage.setMockInitialValues({});
      final api = RootOwnerApi();
      addTearDown(api.close);
      await tester.pumpWidget(MaterialApp(home: DriverSessionPage(api: api)));
      await tester.pumpAndSettle();
      await tester.tap(find.text('English'));
      await tester.pump();
      expect(find.text('Private A'), findsOneWidget);
      api.replace();
      await tester.pumpAndSettle();
      expect(find.text('Food driver sign in'), findsOneWidget);
      expect(find.text('Availability today'), findsNothing);
      expect(find.byType(DriverNavigation), findsNothing);
    },
  );
}
