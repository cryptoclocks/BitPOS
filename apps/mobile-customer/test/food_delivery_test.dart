import 'package:mobile_shared/food_chat_page.dart';

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';
import 'package:bitpos_customer/food_review_page.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:mobile_shared/review_mutation.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/food_navigation_map.dart';

Future<void> captureDelivery(
  WidgetTester tester,
  GlobalKey key,
  String name,
) async {
  const directory = String.fromEnvironment('BITPOS_DS08_CAPTURE_DIR');
  if (directory.isEmpty) return;
  await tester.pump();
  await tester.runAsync(() async {
    final image =
        await (key.currentContext!.findRenderObject() as RenderRepaintBoundary)
            .toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    Directory(directory).createSync(recursive: true);
    await File('$directory/$name.png')
        .writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

Future<void> loadDeliveryFonts() async {
  for (final family in ['NotoSansThai', 'Inter']) {
    await (FontLoader('packages/mobile_shared/$family')..addFont(
          rootBundle.load(
            'packages/mobile_shared/assets/fonts/$family-Variable.ttf',
          ),
        ))
        .load();
  }
  await (FontLoader(
    'MaterialIcons',
  )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
}

String id(int n) => '00000000-0000-4000-8000-${n.toString().padLeft(12, '0')}';
FoodCustomerWork work(int assignment, {bool proof = false}) => FoodCustomerWork(
  dispatch: FoodCustomerDispatch(
    phase: 'ASSIGNED',
    attentionReason: null,
    search: null,
    reassignment: null,
  ),
  shipmentId: id(1),
  state: 'AT_DROPOFF',
  version: '1',
  generation: '1',
  assignment: FoodCustomerAssignment(
    serviceAvailable: true,
    id: id(assignment),
    state: 'AT_DROPOFF',
    generation: '1',
    leaseGeneration: '1',
    location: null,
    deliveryProof: proof
        ? FoodDriverProof(
            id: id(assignment + 100),
            kind: 'DELIVERY',
            expiresAt: DateTime.now()
                .add(const Duration(minutes: 5))
                .toUtc()
                .toIso8601String(),
            attemptsRemaining: 10,
          )
        : null,
  ),
);
FoodCustomerWork delivered() => FoodCustomerWork(
  dispatch: FoodCustomerDispatch(
    phase: 'CLOSED',
    attentionReason: null,
    search: null,
    reassignment: null,
  ),
  shipmentId: id(1),
  state: 'DELIVERED',
  version: '3',
  generation: '1',
  assignment: null,
);

class DeliveryApi extends MobileApi {
  DeliveryApi()
    : super(base: Uri.parse('http://127.0.0.1/api/mobile/v1/'), fixture: true);
  final updates =
      StreamController<
        FoodRealtimeState<FoodCustomerRealtimeSnapshot>
      >.broadcast();
  @override
  Stream<FoodRealtimeState<FoodCustomerRealtimeSnapshot>> watchFoodDelivery(
    String orderId,
  ) => updates.stream;
  FoodCustomerWork _current = work(2);
  MobileApiException? failure;
  FoodCustomerWork get current => _current;
  set current(FoodCustomerWork value) {
    _current = value;
    updates.add(
      FoodRealtimeLive(
        FoodCustomerRealtimeSnapshot(
          serverTime: DateTime.now().toUtc().toIso8601String(),
          cursor: 'f1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          work: value,
        ),
      ),
    );
  }

  @override
  void close() {
    unawaited(updates.close());
    super.close();
  }

  FoodDispatchMutation? pending;
  final submitted = <FoodDispatchMutation>[];
  @override
  bool get signedIn => true;
  @override
  Future<FoodCustomerWork> foodCustomerWork(String orderId) async {
    if (failure case final error?) throw error;
    return current;
  }

  @override
  Future<ReviewMutation?> pendingReviewMutation() async => null;
  @override
  Future<MobileFoodReviewSnapshot> foodReview(String orderId) async =>
      MobileFoodReviewSnapshot(
        orderId: orderId,
        eligible: true,
        canRateDriver: false,
        review: null,
      );
  @override
  Future<FoodDispatchMutation?> pendingFoodDispatch() async => pending;
  @override
  Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
    submitted.add(command);
    pending = null;
    final body = command as FoodDeliveryProofMutation;
    return FoodProofIssueReceipt(
      proofId: id(200),
      assignmentId: command.targetId,
      kind: 'DELIVERY',
      expiresAt: DateTime.now()
          .add(const Duration(minutes: 5))
          .toUtc()
          .toIso8601String(),
      generation: body.command.generation,
      leaseGeneration: body.command.leaseGeneration,
      replayed: true,
      secretRecoveryRequired: false,
      secret: 'fixture-original-assignment-secret',
    );
  }
}

class VisualTrackingApi extends DeliveryApi {
  VisualTrackingApi(this.tile) {
    final base = current, assignment = base.assignment!;
    current = FoodCustomerWork.fromJson({
      ...base.toJson(),
      'state': 'PICKED_UP',
      'assignment': {
        ...assignment.toJson(),
        'state': 'PICKED_UP',
        'location': {
          'sequence': '1',
          'latitudeE7': 0,
          'longitudeE7': 0,
          'accuracyMm': 5000,
          'capturedAt': DateTime.now().toUtc().toIso8601String(),
          'receivedAt': DateTime.now().toUtc().toIso8601String(),
          'stale': false,
        },
      },
    });
  }
  final FoodNavigationTile tile;
  @override
  Future<FoodNavigationSnapshot> foodNavigation({
    String? orderId,
    required String assignmentId,
    required String generation,
    required String leaseGeneration,
  }) async => FoodNavigationSnapshot.fromJson({
    'serverTime': DateTime.now().toUtc().toIso8601String(),
    'assignment': {
      'assignmentId': assignmentId,
      'generation': generation,
      'leaseGeneration': leaseGeneration,
      'shipmentId': id(1),
      'state': 'PICKED_UP',
      'fixture': true,
      'target': 'DROPOFF',
      'targetLatitudeE7': 0,
      'targetLongitudeE7': 10000,
      'location': current.assignment!.location!.toJson(),
    },
    'route': {
      'points': [
        {'latitudeE7': 0, 'longitudeE7': 0},
        {'latitudeE7': 0, 'longitudeE7': 10000},
      ],
      'durationSeconds': 600,
      'distanceMetres': 2100,
      'fixture': true,
      'attribution': 'Synthetic route fixture',
    },
    'routeUnavailable': null,
    'tilesAvailable': true,
    'tileAttribution': 'Synthetic tile fixture',
    'tileFixture': true,
  });
  @override
  Future<FoodNavigationTile> foodNavigationTile({
    String? orderId,
    required String assignmentId,
    required String generation,
    required String leaseGeneration,
    required int z,
    required int x,
    required int y,
  }) async => tile;
}

class ChatDeliveryApi extends DeliveryApi {
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
    myRole: 'CUSTOMER',
    items: [
      FoodChatMessage(
        attachments: const [],
        id: id(400),
        assignmentId: assignmentId,
        commandId: id(401),
        sequence: '1',
        senderRole: 'DRIVER',
        mine: false,
        body: 'Private assigned rider note',
        createdAt: '2026-10-20T01:00:00Z',
      ),
    ],
    nextAfterSequence: null,
    nextBeforeSequence: null,
    latestSequence: '1',
  );
}

Future<void> mount(
  WidgetTester tester,
  DeliveryApi api, {
  VoidCallback? auth,
  ValueChanged<int>? onNavigationSelected,
  MobileMoney? orderTotal,
  VoidCallback? onViewReceipt,
}) async {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SingleChildScrollView(
          child: FoodDeliveryPanel(
            api: api,
            orderId: id(1),
            orderTotal: orderTotal,
            thai: false,
            onAuthenticationRequired: auth ?? () {},
            onViewReceipt: onViewReceipt,
            onNavigationSelected: onNavigationSelected,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'U20 tracking page 390 TH uses labelled provider fixture and reachable actions',
    (tester) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.reset);
      await loadDeliveryFonts();
      final tile = await tester.runAsync(() async {
        final recorder = ui.PictureRecorder();
        Canvas(recorder).drawColor(const Color(0xffeae9e2), BlendMode.src);
        final picture = recorder.endRecording();
        final image = await picture.toImage(256, 256);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final result = FoodNavigationTile(
          pngBase64: base64Encode(bytes!.buffer.asUint8List()),
          fixture: true,
          attribution: 'Synthetic tile fixture',
        );
        image.dispose();
        picture.dispose();
        return result;
      });
      expect(tile, isNotNull);
      final api = VisualTrackingApi(tile!);
      addTearDown(api.close);
      final boundary = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            theme: BitPosTheme.light(),
            debugShowCheckedModeBanner: false,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                padding: const EdgeInsets.only(top: 44, bottom: 34),
                viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
              ),
              child: child!,
            ),
            home: FoodDeliveryPage(
              api: api,
              orderId: id(1),
              thai: true,
              onAuthenticationRequired: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byType(FoodNavigationMap), findsOneWidget);
      expect(find.textContaining('เวลาเดินทางตามเส้นทาง'), findsOneWidget);
      expect(
        find.textContaining('ข้อมูลจำลอง ไม่ใช่การส่งจริง'),
        findsOneWidget,
      );
      await captureDelivery(tester, boundary, 'U20-tracking-TH');
      await tester.tap(find.text('ข้อมูลแผนที่และตำแหน่ง'));
      await tester.pumpAndSettle();
      expect(find.textContaining('แผนที่กริดจำลอง'), findsOneWidget);
      await tester.ensureVisible(find.text('แชท'));
      expect(find.text('รายละเอียด'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  for (final thai in [true, false]) {
    testWidgets('U38 matching and no-driver page 390 ${thai ? 'TH' : 'EN'}', (
      tester,
    ) async {
      tester.view.devicePixelRatio = 1;
      tester.view.physicalSize = const Size(390, 844);
      addTearDown(tester.view.reset);
      await loadDeliveryFonts();
      final api = DeliveryApi();
      addTearDown(api.close);
      api.current = FoodCustomerWork.fromJson({
        ...api.current.toJson(),
        'state': 'READY_FOR_DISPATCH',
        'assignment': null,
        'dispatch': {
          'phase': 'SEARCHING',
          'attentionReason': null,
          'search': null,
          'reassignment': null,
        },
      });
      final boundary = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            theme: BitPosTheme.light(),
            debugShowCheckedModeBanner: false,
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context).copyWith(
                padding: const EdgeInsets.only(top: 44, bottom: 34),
                viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
              ),
              child: child!,
            ),
            home: FoodDeliveryPage(
              api: api,
              orderId: id(1),
              thai: thai,
              onAuthenticationRequired: () {},
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('food-delivery-matching-hero')),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(const ValueKey('food-delivery-matching-hero')),
          matching: find.text(
            thai ? 'กำลังหาไรเดอร์ให้คุณ' : 'Finding a driver for you',
          ),
        ),
        findsOneWidget,
      );
      expect(find.byType(FoodNavigationMap), findsNothing);
      await captureDelivery(
        tester,
        boundary,
        'U38-search-${thai ? 'TH' : 'EN'}',
      );
      api.current = FoodCustomerWork.fromJson({
        ...api.current.toJson(),
        'dispatch': {
          'phase': 'NEEDS_ATTENTION',
          'attentionReason': 'NO_CANDIDATE',
          'search': null,
          'reassignment': null,
        },
      });
      await tester.pumpAndSettle();
      expect(
        find.text(thai ? 'ยังไม่พบไรเดอร์' : 'No driver available yet'),
        findsOneWidget,
      );
      expect(find.byType(FoodNavigationMap), findsNothing);
      await captureDelivery(
        tester,
        boundary,
        'U38-no-driver-${thai ? 'TH' : 'EN'}',
      );
      expect(tester.takeException(), isNull);
    });
  }
  testWidgets(
    'failed closed delivery does not show success, proof or refund confirmation',
    (tester) async {
      final api = DeliveryApi()
        ..current = FoodCustomerWork(
          shipmentId: id(1),
          state: 'FAILED',
          version: '4',
          generation: '1',
          assignment: null,
          dispatch: FoodCustomerDispatch(
            phase: 'CLOSED',
            attentionReason: null,
            search: null,
            reassignment: null,
          ),
        );
      addTearDown(api.close);
      await mount(tester, api);
      expect(find.text('Delivery unsuccessful'), findsOneWidget);
      expect(
        find.textContaining('This does not confirm a refund.'),
        findsOneWidget,
      );
      expect(find.byType(FoodReviewPage), findsNothing);
      expect(find.text('Delivered to you'), findsNothing);
      expect(find.text('Chat with rider'), findsNothing);
      expect(api.submitted, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'customer chat bottom navigation forwards Orders and lets the root replace the private chat route',
    (tester) async {
      final api = ChatDeliveryApi();
      addTearDown(api.close);
      var selected = -1;
      await mount(
        tester,
        api,
        onNavigationSelected: (index) {
          selected = index;
          Navigator.of(tester.element(find.byType(FoodChatPageView))).pop();
        },
      );
      final chat = find.text('Chat with rider');
      await tester.ensureVisible(chat);
      await tester.tap(chat);
      await tester.pumpAndSettle();
      expect(find.byType(FoodChatPageView), findsOneWidget);
      expect(find.text('Activity'), findsOneWidget);
      await tester.tap(find.text('Activity'));
      await tester.pumpAndSettle();
      expect(selected, 1);
      expect(find.byType(FoodChatPageView), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'server-delivered shipment opens U21 success, review and receipt route',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      final api = DeliveryApi()..current = delivered();
      addTearDown(api.close);
      var receipt = 0, tab = -1;
      await mount(
        tester,
        api,
        orderTotal: MobileMoney(
          currency: 'THB',
          decimals: 2,
          amountMinor: '20500',
        ),
        onViewReceipt: () => receipt++,
        onNavigationSelected: (value) => tab = value,
      );
      expect(find.byType(FoodReviewPage), findsOneWidget);
      expect(find.text('Delivered to you'), findsOneWidget);
      expect(find.textContaining('205.00'), findsOneWidget);
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        1,
      );
      await tester.tap(find.text('Activity'));
      expect(tab, 1);
      await tester.ensureVisible(find.text('View receipt'));
      await tester.tap(find.text('View receipt'));
      expect(receipt, 1);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'rotated valid session does not eject the customer into authentication',
    (tester) async {
      final api = DeliveryApi()
        ..failure = const MobileApiException('SESSION_CHANGED', 409);
      addTearDown(api.close);
      var authRequired = 0;
      await mount(tester, api, auth: () => authRequired++);
      expect(authRequired, 0);
    },
  );
  testWidgets(
    'another displayed assignment can recover the exact original pending proof without exposing its secret',
    (tester) async {
      final original = FoodDeliveryProofMutation(
        id(3),
        FoodProofIssueCommand(
          idempotencyKey: id(4),
          generation: '7',
          leaseGeneration: '9',
          rotate: true,
        ),
      );
      final api = DeliveryApi()..pending = original;
      addTearDown(api.close);
      await mount(tester, api);
      final retry = find.textContaining('Retry original proof command');
      await tester.ensureVisible(retry);
      await tester.tap(retry);
      await tester.pumpAndSettle();
      expect(api.submitted.map((command) => command.toJson()).toList(), [
        original.toJson(),
      ]);
      expect(find.text('fixture-original-assignment-secret'), findsNothing);
      expect(api.pending, isNull);
    },
  );
  testWidgets(
    'confirmation opened for one assignment cannot rotate a replacement assignment proof',
    (tester) async {
      final api = DeliveryApi()..current = work(2, proof: true);
      addTearDown(api.close);
      await mount(tester, api);
      final replace = find.text('Replace delivery proof');
      await tester.ensureVisible(replace);
      await tester.tap(replace);
      await tester.pumpAndSettle();
      api.current = work(3, proof: true);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Replace'));
      await tester.pumpAndSettle();
      expect(api.submitted, isEmpty);
    },
  );
  testWidgets(
    'service restriction closes proof confirmation and removes fresh custody actions',
    (tester) async {
      final api = DeliveryApi()..current = work(2, proof: true);
      addTearDown(api.close);
      await mount(tester, api);
      final replace = find.text('Replace delivery proof');
      await tester.ensureVisible(replace);
      await tester.tap(replace);
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsOneWidget);
      final current = api.current, a = current.assignment!;
      api.current = FoodCustomerWork.fromJson({
        ...current.toJson(),
        'dispatch': {...current.dispatch.toJson(), 'phase': 'NEEDS_ATTENTION'},
        'assignment': {
          ...a.toJson(),
          'serviceAvailable': false,
          'location': null,
          'deliveryProof': null,
        },
      });
      await tester.pumpAndSettle();
      expect(find.byType(AlertDialog), findsNothing);
      expect(find.text('Replace delivery proof'), findsNothing);
      expect(find.text('Issue delivery proof'), findsNothing);
      expect(api.submitted, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'released custody clears the old driver proof while matching, staff attention and disconnect stay distinct',
    (tester) async {
      final api = DeliveryApi()..current = work(2, proof: true);
      addTearDown(api.close);
      await mount(tester, api);
      expect(find.text('Replace delivery proof'), findsOneWidget);
      final released = {
        ...api.current.toJson(),
        'state': 'READY_FOR_DISPATCH',
        'generation': '2',
        'assignment': null,
        'dispatch': {
          'phase': 'SEARCHING',
          'attentionReason': null,
          'search': {'version': '2', 'expiresAt': '2099-01-01T00:00:00Z'},
          'reassignment': {
            'count': 1,
            'lastReleasedAt': '2026-10-19T00:00:00Z',
          },
        },
      };
      api.current = FoodCustomerWork.fromJson(released);
      await tester.pumpAndSettle();
      expect(find.text('Replace delivery proof'), findsNothing);
      expect(find.textContaining('Proof expires'), findsNothing);
      expect(find.text('Matching a driver'), findsOneWidget);
      expect(
        find.textContaining('Pre-pickup assignments released: 1'),
        findsOneWidget,
      );
      expect(api.submitted, isEmpty);
      api.current = FoodCustomerWork.fromJson({
        ...released,
        'dispatch': {
          ...(released['dispatch'] as Map<String, Object?>),
          'phase': 'NEEDS_ATTENTION',
          'attentionReason': 'NO_CANDIDATE',
        },
      });
      await tester.pumpAndSettle();
      expect(find.text('Matching a driver'), findsNothing);
      expect(
        find.textContaining('No eligible driver was found'),
        findsOneWidget,
      );
      expect(find.text('Issue delivery proof'), findsNothing);
      expect(api.submitted, isEmpty);
      api.updates.add(
        const FoodRealtimeDisconnected(
          MobileApiException('REALTIME_DISCONNECTED', 503),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('No eligible driver was found'), findsNothing);
      expect(
        find.textContaining('Pre-pickup assignments released'),
        findsNothing,
      );
      expect(find.textContaining('Matching window ends'), findsNothing);
      expect(api.submitted, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'reassignment removes exact open chat route and previous rider plaintext',
    (tester) async {
      final api = ChatDeliveryApi();
      addTearDown(api.close);
      await mount(tester, api);
      await tester.ensureVisible(find.text('Chat with rider'));
      await tester.tap(find.text('Chat with rider'));
      await tester.pumpAndSettle();
      expect(find.byType(FoodChatPageView), findsOneWidget);
      expect(find.text('Private assigned rider note'), findsOneWidget);
      api.current = work(3);
      await tester.pumpAndSettle();
      expect(find.byType(FoodChatPageView), findsNothing);
      expect(find.text('Private assigned rider note'), findsNothing);
      expect(api.submitted, isEmpty);
      expect(tester.takeException(), isNull);
    },
  );
}
