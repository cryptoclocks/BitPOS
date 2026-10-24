// UI-only local API/native fixtures. No backend, payment or physical GPS proof.
// Optional BITPOS_RIDER_CAPTURE_DIR retains actual Flutter-engine PNGs/geometry.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:bitpos_driver/food_work_page.dart';
import 'package:bitpos_driver/daily_earnings_summary.dart';
import 'package:bitpos_driver/driver_rating_summary.dart';
import 'package:bitpos_driver/presentation/driver_home_metrics.dart';
import 'package:bitpos_driver/work_availability.dart';
import 'package:bitpos_driver/presentation/driver_food_offer_card.dart';
import 'package:bitpos_driver/presentation/driver_job_details_card.dart';
import 'package:bitpos_driver/presentation/driver_assigned_navigation_card.dart';
import 'package:bitpos_driver/presentation/driver_navigation.dart';
import 'package:bitpos_driver/presentation/driver_work_map_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:mobile_shared/food_navigation_map.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

import 'food_realtime_lifecycle_test.dart' as fixture;
import 'driver_identity_test.dart' show DriverApi;
import 'driver_home_metrics_test.dart' show MetricsApi;

class SurfaceWorkApi extends fixture.LiveWorkApi {
  final availability = DriverApi()
    ..expiry = DateTime.now().add(const Duration(minutes: 5));
  final metrics = MetricsApi();
  @override
  void close() {
    availability.close();
    metrics.close();
    super.close();
  }

  @override
  Future<FoodDiscoverySnapshot> foodDiscovery() async =>
      FoodDiscoverySnapshot(services: [], consent: null);
  @override
  Future<FoodDiscoveryConsentCommand?> pendingFoodDiscoveryConsent() async =>
      null;
  @override
  Future<FoodNavigationSnapshot> foodNavigation({
    String? orderId,
    required String assignmentId,
    required String generation,
    required String leaseGeneration,
  }) async => throw const MobileApiException('MAP_PROVIDER_UNAVAILABLE', 503);
}

late FoodNavigationTile surfaceNavigationTile;

Future<void> loadSurfaceNavigationTile() async {
  final recorder = ui.PictureRecorder();
  Canvas(recorder).drawColor(Colors.purple.shade50, BlendMode.src);
  final picture = recorder.endRecording();
  final image = await picture.toImage(256, 256);
  final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
  surfaceNavigationTile = FoodNavigationTile(
    pngBase64: base64Encode(bytes!.buffer.asUint8List()),
    fixture: true,
    attribution: 'Original local Rider surface grid',
  );
  image.dispose();
  picture.dispose();
}

class AssignedNavigationApi extends SurfaceWorkApi {
  bool unavailable = false, stale = false;
  FoodDispatchMutation? pending;
  Completer<void>? arrivalGate;
  final navigationBindings =
      <({String id, String generation, String lease, String state})>[];

  @override
  ({String accountId, String sessionId})? get sessionScope => authenticated
      ? (
          accountId: '11111111-1111-4111-8111-111111111111',
          sessionId: '22222222-2222-4222-8222-222222222222',
        )
      : null;

  @override
  Future<FoodDispatchMutation?> pendingFoodDispatch() async => pending;

  @override
  Future<FoodNavigationSnapshot> foodNavigation({
    String? orderId,
    required String assignmentId,
    required String generation,
    required String leaseGeneration,
  }) async {
    final a = current.assignment as FoodDriverAssignment;
    navigationBindings.add((
      id: assignmentId,
      generation: generation,
      lease: leaseGeneration,
      state: a.state,
    ));
    if (unavailable) {
      throw const MobileApiException('MAP_PROVIDER_UNAVAILABLE', 503);
    }
    final pickup = a.state == 'ACCEPTED' || a.state == 'AT_PICKUP';
    final now = DateTime.now().toUtc().toIso8601String();
    final latitude = pickup ? a.pickupLatitudeE7 : a.latitudeE7;
    final longitude = pickup ? a.pickupLongitudeE7 : a.longitudeE7;
    return FoodNavigationSnapshot(
      serverTime: now,
      assignment: FoodNavigationAssignment(
        assignmentId: assignmentId,
        generation: generation,
        leaseGeneration: leaseGeneration,
        shipmentId: a.shipmentId,
        state: a.state,
        fixture: true,
        target: pickup ? 'PICKUP' : 'DROPOFF',
        targetLatitudeE7: latitude,
        targetLongitudeE7: longitude,
        location: FoodTrackedLocation(
          sequence: '1',
          latitudeE7: latitude - 100000,
          longitudeE7: longitude - 100000,
          accuracyMm: 5000,
          capturedAt: stale ? DateTime.utc(2000).toIso8601String() : now,
          receivedAt: now,
          stale: false,
        ),
      ),
      route: FoodNavigationRoute(
        points: [
          FoodMapPoint(
            latitudeE7: latitude - 100000,
            longitudeE7: longitude - 100000,
          ),
          FoodMapPoint(latitudeE7: latitude, longitudeE7: longitude),
        ],
        durationSeconds: pickup ? 180 : 420,
        distanceMetres: pickup ? 1300 : 2700,
        fixture: true,
        attribution: 'Original local Rider surface route',
      ),
      routeUnavailable: null,
      tilesAvailable: true,
      tileAttribution: surfaceNavigationTile.attribution,
      tileFixture: true,
    );
  }

  @override
  Future<FoodNavigationTile> foodNavigationTile({
    String? orderId,
    required String assignmentId,
    required String generation,
    required String leaseGeneration,
    required int z,
    required int x,
    required int y,
  }) async => surfaceNavigationTile;

  @override
  Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
    if (command is! FoodArrivalMutation) {
      return super.submitFoodDispatch(command);
    }
    submitted.add(command);
    pending = command;
    if (arrivalGate case final gate?) await gate.future;
    final a = current.assignment as FoodDriverAssignment;
    final next = command.command.stage == 'PICKUP' ? 'AT_PICKUP' : 'AT_DROPOFF';
    current = FoodDriverWork(
      offers: [],
      assignment: FoodDriverAssignment.fromJson({
        ...a.toJson(),
        'state': next,
      }),
    );
    pending = null;
    return FoodArrivalReceipt(
      assignmentId: a.id,
      generation: a.generation,
      leaseGeneration: a.leaseGeneration,
      state: next,
    );
  }
}

Widget surfacePage(SurfaceWorkApi api, String screen, bool thai, {ValueChanged<bool>? onTravelModeChanged}) =>
    FoodWorkPage(
      api: api,
      thai: thai,
      onTravelModeChanged: onTravelModeChanged,
      availability: ['R06', 'R09', 'R12'].contains(screen)
          ? WorkAvailability(api: api.availability, thai: thai)
          : null,
      dailySummary: ['R06', 'R09', 'R12'].contains(screen)
          ? DriverHomeMetrics(
              earnings: DriverDailySummary(
                api: api.metrics,
                thai: thai,
                compact: true,
              ),
              rating: DriverRatingSummary(api: api.metrics, thai: thai),
            )
          : null,
    );

Future<void> revealAssignedTarget(
  WidgetTester tester,
  Finder target, {
  bool reverse = false,
}) async {
  // Swipe the page gutter, not the private map's independent pan viewport.
  for (var pass = 0; target.evaluate().isEmpty && pass < 30; pass++) {
    await tester.dragFrom(
      const Offset(12, 700),
      Offset(0, reverse ? 240 : -240),
    );
    await tester.pumpAndSettle();
  }
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
}

Future<fixture.ActiveNative> mountAssignedSurface(
  WidgetTester tester,
  AssignedNavigationApi api,
  String screen, {
  double width = 390,
  bool thai = false,
  double textScale = 1,
}) async {
  tester.view.physicalSize = Size(width, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final previous = GeolocatorPlatform.instance;
  final native = fixture.ActiveNative();
  GeolocatorPlatform.instance = native;
  addTearDown(() {
    api.close();
    native.close();
    GeolocatorPlatform.instance = previous;
  });
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  final travelMode = ValueNotifier(false);
  addTearDown(travelMode.dispose);
  await tester.pumpWidget(MaterialApp(
    theme: BitPosTheme.light(),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(textScale)),
      child: child!,
    ),
    home: DriverDestination(
      thai: thai,
      index: 0,
      travelMode: travelMode,
      child: surfacePage(api, screen, thai, onTravelModeChanged: (value) => travelMode.value = value),
    ),
  ));
  await tester.pumpAndSettle();
  return native;
}

Future<void> revealSurfaceOffer(WidgetTester tester, bool thai) async {
  await tester.tap(find.text(thai ? 'ดูงานที่เสนอให้คุณ' : 'View your offers'));
  await tester.pumpAndSettle();
  expect(
    find.text(thai ? 'งานใหม่ใกล้คุณ' : 'Offers near you'),
    findsOneWidget,
  );
  final offer = find.byType(DriverFoodOfferCard);
  await tester.scrollUntilVisible(
    offer,
    120,
    maxScrolls: 20,
    scrollable: find
        .descendant(
          of: find.byType(ListView).first,
          matching: find.byType(Scrollable),
        )
        .first,
  );
  await tester.ensureVisible(offer);
  await tester.pumpAndSettle();
}

FoodDriverWork surfaceWork(String screen, bool thai) {
  if (screen == 'R06' || screen == 'R07') {
    return FoodDriverWork(
      offers: screen == 'R06'
          ? []
          : [
              FoodDriverOffer(
                id: '11111111-1111-4111-8111-111111111111',
                shipmentId: '22222222-2222-4222-8222-222222222222',
                generation: '1',
                version: '1',
                expiresAt: DateTime.now()
                    .add(const Duration(minutes: 5))
                    .toUtc()
                    .toIso8601String(),
                pickupLatitudeE7: 137560000,
                pickupLongitudeE7: 1005018000,
                earning: MobileMoney(
                  currency: 'USDG',
                  decimals: 6,
                  amountMinor: '550000',
                ),
                fixture: true,
              ),
            ],
      assignment: null,
    );
  }
  final base =
      fixture
              .work(
                name: thai
                    ? 'ผู้รับตัวอย่างในเครื่อง'
                    : 'Local fixture recipient',
              )
              .assignment
          as FoodDriverAssignment;
  final kind = screen == 'R13' ? 'DELIVERY' : 'PICKUP';
  return FoodDriverWork(
    offers: [],
    assignment: FoodDriverAssignment.fromJson({
      ...base.toJson(),
      'state': switch (screen) {
        'R08' || 'R09' => 'ACCEPTED',
        'R11' => 'AT_PICKUP',
        'R12' => 'PICKED_UP',
        _ => 'AT_DROPOFF',
      },
      'addressText': thai
          ? 'อาคารตัวอย่าง ประตูด้านหลัง ชั้นสอง'
          : 'Local fixture building, rear entrance, second floor',
      'instructions': thai
          ? 'กรุณายืนยันผู้รับก่อนส่งมอบ'
          : 'Confirm recipient before handover',
      'earning': {'currency': 'USDG', 'decimals': 6, 'amountMinor': '550000'},
      'proofs': ['R08', 'R09', 'R12'].contains(screen)
          ? []
          : [
              {
                'id': '22222222-2222-4222-8222-222222222222',
                'kind': kind,
                'expiresAt': DateTime.now()
                    .add(const Duration(minutes: 5))
                    .toUtc()
                    .toIso8601String(),
                'attemptsRemaining': 10,
              },
            ],
    }),
  );
}

Future<void> loadSurfaceFonts() async {
  for (final name in ['NotoSansThai', 'Inter']) {
    final loader = FontLoader('packages/mobile_shared/$name');
    loader.addFont(
      rootBundle.load('packages/mobile_shared/assets/fonts/$name-Variable.ttf'),
    );
    await loader.load();
  }
  final icons = FontLoader('MaterialIcons');
  icons.addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'));
  await icons.load();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(loadSurfaceFonts);
  setUpAll(loadSurfaceNavigationTile);
  for (final screen in ['R06', 'R07', 'R08', 'R09', 'R11', 'R12', 'R13']) {
    for (final state in [
      (width: 390.0, thai: true, dark: false, scale: 1.0),
      (width: 390.0, thai: false, dark: false, scale: 1.0),
      (width: 320.0, thai: true, dark: true, scale: 1.5),
      (width: 320.0, thai: false, dark: true, scale: 1.5),
      if (['R09', 'R12', 'R11', 'R13'].contains(screen))
        (width: 1440.0, thai: true, dark: false, scale: 1.0),
      if (['R09', 'R12', 'R11', 'R13'].contains(screen))
        (width: 1440.0, thai: false, dark: true, scale: 1.5),
    ]) {
      testWidgets(
        '$screen ${state.width} TH=${state.thai} dark=${state.dark} scale=${state.scale}',
        (tester) async {
          tester.view.physicalSize = Size(state.width, 844);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.resetPhysicalSize);
          addTearDown(tester.view.resetDevicePixelRatio);
          final previous = GeolocatorPlatform.instance;
          final native = fixture.ActiveNative();
          GeolocatorPlatform.instance = native;
          final SurfaceWorkApi api = screen == 'R09' || screen == 'R12'
              ? AssignedNavigationApi()
              : SurfaceWorkApi();
          api.current = surfaceWork(screen, state.thai);
          addTearDown(() {
            api.close();
            native.close();
            GeolocatorPlatform.instance = previous;
          });
          final boundary = GlobalKey();
          final travelMode = ValueNotifier(false);
          addTearDown(travelMode.dispose);
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.resumed,
          );
          await tester.pumpWidget(
            MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: state.dark ? BitPosTheme.dark() : BitPosTheme.light(),
              builder: (context, child) => MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: TextScaler.linear(state.scale),
                  padding: const EdgeInsets.only(top: 44),
                ),
                child: child!,
              ),
              home: RepaintBoundary(
                key: boundary,
                child: DriverDestination(
                  thai: state.thai,
                  index: 0,
                  travelMode: travelMode,
                  child: surfacePage(api, screen, state.thai, onTravelModeChanged: (value) => travelMode.value = value),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          if (screen == 'R06') {
            final brand = tester.getRect(find.bySemanticsLabel('BitPOS'));
            expect(brand.left, 24);
            expect(brand.top, 52);
            expect(brand.width, 104);
            expect(brand.height, closeTo(104 / 3, .1));
          }
          final destinationRect = screen == 'R11' || screen == 'R13'
              ? tester.getRect(
                  find.byKey(const ValueKey('food-handover-destination')),
                )
              : null;
          final target = screen == 'R06'
              ? find.byType(DriverWorkMapCard)
              : screen == 'R07'
              ? find.byType(DriverFoodOfferCard)
              : screen == 'R08'
              ? find.byType(DriverJobDetailsCard)
              : screen == 'R09' || screen == 'R12'
              ? find.byKey(ValueKey(
                  'food-assigned-arrive-${screen == 'R09' ? 'PICKUP' : 'DROPOFF'}',
                ))
              : find.byKey(
                  ValueKey(
                    'food-custody-${screen == 'R11' ? 'PICKUP' : 'DELIVERY'}',
                  ),
                );
          if (screen == 'R07') {
            await revealSurfaceOffer(tester, state.thai);
          }
          if (screen == 'R08' || screen == 'R09' || screen == 'R12') {
            if (screen != 'R08') {
              expect(find.byType(InteractiveViewer), findsOneWidget);
              expect(
                tester.getRect(find.byType(InteractiveViewer)).top,
                lessThan(250),
                reason: 'Home availability/metrics must not displace the travel map.',
              );
            }
            await revealAssignedTarget(tester, target);
            if (screen != 'R08') {
              expect(target.hitTestable(), findsOneWidget);
            }
          }
          if (screen == 'R11' || screen == 'R13') {
            if (state.scale == 1) {
              expect(
                target.hitTestable(),
                findsOneWidget,
                reason: 'Custody action must not be buried below navigation/full job details at reference size.',
              );
            }
            if (target.hitTestable().evaluate().isEmpty) {
              await tester.scrollUntilVisible(target, 200);
              await tester.ensureVisible(target);
              await tester.pumpAndSettle();
            }
            final navigationTop = tester
                .getTopLeft(find.byType(DriverNavigation))
                .dy;
            if (tester.getBottomRight(target).dy > navigationTop) {
              await tester.ensureVisible(target);
              await tester.pumpAndSettle();
            }
            expect(
              tester.getBottomRight(target).dy,
              lessThanOrEqualTo(navigationTop),
            );
            expect(tester.getSize(target).height, greaterThanOrEqualTo(48));
          }
          expect(tester.takeException(), isNull);
          final rect = tester.getRect(target);
          expect(rect.left, greaterThanOrEqualTo(24));
          expect(rect.right, lessThanOrEqualTo(state.width - 24));
          List<double> bounds(Finder finder) {
            final box = tester.getRect(finder);
            return [box.left, box.top, box.width, box.height];
          }

          final name =
              '$screen-${state.thai ? 'th' : 'en'}-${state.dark ? 'dark' : 'light'}-${state.width.toInt()}-${state.scale}';
          final geometry = {
            'screen': screen,
            'viewport': [state.width, 844],
            'locale': state.thai ? 'th' : 'en',
            'dark': state.dark,
            'textScale': state.scale,
            'target': [rect.left, rect.top, rect.width, rect.height],
            'navigation': find.byType(DriverNavigation).evaluate().isEmpty ? null : bounds(find.byType(DriverNavigation)),
            if (destinationRect != null)
              'destinationAtInitialScroll': [
                destinationRect.left,
                destinationRect.top,
                destinationRect.width,
                destinationRect.height,
              ],
          };
          debugPrint('RIDER_SURFACE_GEOMETRY ${jsonEncode(geometry)}');
          final dir = Platform.environment['BITPOS_RIDER_CAPTURE_DIR'];
          if (dir != null) {
            await tester.runAsync(() async {
              final image =
                  await (boundary.currentContext!.findRenderObject()
                          as RenderRepaintBoundary)
                      .toImage(pixelRatio: 1);
              final bytes = await image.toByteData(
                format: ui.ImageByteFormat.png,
              );
              await File('$dir/$name.png')
                  .writeAsBytes(bytes!.buffer.asUint8List());
              await File('$dir/$name.json').writeAsString(jsonEncode(geometry));
              image.dispose();
            });
          }
          if (screen == 'R11' || screen == 'R13') {
            await tester.tap(target);
            // _run remains busy while the dialog is open; its visible progress
            // indicator deliberately never settles until the dialog closes.
            await tester.pump();
            await tester.pump(const Duration(milliseconds: 300));
            expect(find.byType(AlertDialog), findsOneWidget);
            await tester.enterText(
              find.byType(TextField),
              'local-unsubmitted-proof',
            );
            await tester.tap(find.text(state.thai ? 'ยกเลิก' : 'Cancel'));
            await tester.pumpAndSettle();
            expect(api.submitted, isEmpty);
            expect(find.text('local-unsubmitted-proof'), findsNothing);
          }
          // Exercise the entire scrollable surface, not only its first viewport.
          await tester.drag(
            find.byType(ListView).first,
            const Offset(0, -4000),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          expect(api.submitted, isEmpty);
          await tester.pumpWidget(const MaterialApp(home: SizedBox()));
          await tester.pumpAndSettle();
        },
      );
    }
  }
  for (final screen in ['R09', 'R12']) {
    final stage = screen == 'R09' ? 'PICKUP' : 'DROPOFF';
    final metric = screen == 'R09' ? '1.3 km' : '2.7 km';
    testWidgets(
      '$screen unavailable/stale recovery preserves GPS consent and authoritative $stage arrival',
      (tester) async {
        final api = AssignedNavigationApi()
          ..current = surfaceWork(screen, false)
          ..unavailable = true;
        final native = await mountAssignedSurface(tester, api, screen);
        final assignment = api.current.assignment as FoodDriverAssignment;
        final action = find.byKey(ValueKey('food-assigned-arrive-$stage'));
        expect(find.text('Map unavailable'), findsOneWidget);
        expect(find.byType(InteractiveViewer), findsNothing);
        expect(find.textContaining(metric), findsNothing);
        expect(native.positions.hasListener, isFalse);

        api
          ..unavailable = false
          ..stale = true;
        final refresh = find.byTooltip('Refresh route');
        await revealAssignedTarget(tester, refresh);
        await tester.tap(refresh);
        await tester.pumpAndSettle();
        expect(find.text('Stale location; current ETA unavailable'), findsOneWidget);
        expect(find.textContaining(metric), findsNothing);
        expect(find.byType(InteractiveViewer), findsOneWidget);
        expect(native.positions.hasListener, isFalse);

        api.stale = false;
        await revealAssignedTarget(tester, refresh);
        await tester.tap(refresh);
        await tester.pumpAndSettle();
        expect(find.textContaining(metric), findsOneWidget);
        expect(find.text('Stale location; current ETA unavailable'), findsNothing);
        expect(find.text('Synthetic grid map; not real streets'), findsOneWidget);
        final mapTop = tester.getTopLeft(find.byType(FoodNavigationMap)).dy;
        final actionsTop = tester.getTopLeft(find.byKey(
          const ValueKey('food-assigned-navigation-actions'),
        )).dy;
        expect(mapTop, lessThan(actionsTop));
        await revealAssignedTarget(tester, action);
        final position = Scrollable.of(tester.element(action)).position;
        final actionBottom = tester.getBottomRight(action).dy + position.pixels;
        expect(tester.widget<FilledButton>(action).onPressed, isNotNull);
        expect(tester.getSize(action).height, greaterThanOrEqualTo(48));
        await revealAssignedTarget(tester, find.byType(DriverJobDetailsCard));
        final detailsTop =
            tester.getTopLeft(find.byType(DriverJobDetailsCard)).dy + position.pixels;
        expect(actionBottom, lessThan(detailsTop));
        final gps = find.text('Allow and start assignment GPS');
        await revealAssignedTarget(tester, gps);
        expect(gps.hitTestable(), findsOneWidget);
        expect(find.text('No acknowledged fix for this assignment'), findsOneWidget);
        expect(native.positions.hasListener, isFalse);

        await revealAssignedTarget(tester, action, reverse: true);
        final gate = Completer<void>();
        api.arrivalGate = gate;
        await tester.tap(action);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 100));
        expect(tester.widget<FilledButton>(action).onPressed, isNull);
        expect(tester.widget<OutlinedButton>(find.byKey(
          const ValueKey('food-assigned-navigation-chat'),
        )).onPressed, isNull);
        expect(api.submitted.single, isA<FoodArrivalMutation>()
            .having((value) => value.targetId, 'assignment', assignment.id)
            .having((value) => value.command.stage, 'arrival stage', stage)
            .having((value) => value.command.generation, 'generation', assignment.generation)
            .having((value) => value.command.leaseGeneration, 'lease', assignment.leaseGeneration));
        gate.complete();
        await tester.pumpAndSettle();
        await tester.dragFrom(const Offset(12, 400), const Offset(0, 4000));
        await tester.pumpAndSettle();
        await revealAssignedTarget(tester, find.byKey(const ValueKey('food-handover-destination')));
        expect(find.byType(DriverAssignedNavigationCard), findsNothing);
        expect(find.byKey(const ValueKey('food-handover-destination')), findsOneWidget);
        expect(find.text('Waiting for merchant/customer proof. Refresh to recover.'), findsOneWidget);
        expect(api.current.assignment, isA<FoodDriverAssignment>()
            .having((value) => value.state, 'server-confirmed phase',
                screen == 'R09' ? 'AT_PICKUP' : 'AT_DROPOFF'));
        expect(native.positions.hasListener, isFalse);
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const MaterialApp(home: SizedBox()));
        await tester.pumpAndSettle();
      },
    );
    testWidgets('$screen pending arrival recovers the original command only', (tester) async {
      final api = AssignedNavigationApi()..current = surfaceWork(screen, false);
      final assignment = api.current.assignment as FoodDriverAssignment;
      final command = api.arriveFoodCommand(assignment, stage);
      api.pending = command;
      final native = await mountAssignedSurface(tester, api, screen);
      final action = find.byKey(ValueKey('food-assigned-arrive-$stage'));
      await revealAssignedTarget(tester, action);
      expect(tester.widget<FilledButton>(action).onPressed, isNull);
      expect(tester.widget<OutlinedButton>(find.byKey(
        const ValueKey('food-assigned-navigation-chat'),
      )).onPressed, isNull);
      final recover = find.text('Recover same command');
      await revealAssignedTarget(tester, recover, reverse: true);
      await tester.tap(recover);
      await tester.pumpAndSettle();
      expect(api.submitted.single, same(command));
      expect(api.pending, isNull);
      expect(native.positions.hasListener, isFalse);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pumpAndSettle();
    });
    testWidgets('$screen restricted duty retires map, recipient and arrival', (tester) async {
      final api = AssignedNavigationApi()..current = surfaceWork(screen, false);
      final native = await mountAssignedSurface(tester, api, screen);
      expect(find.byType(InteractiveViewer), findsOneWidget);
      expect(find.textContaining(metric), findsOneWidget);
      final a = api.current.assignment as FoodDriverAssignment;
      api.publish(FoodDriverWork(
        offers: [],
        assignment: FoodDriverRestrictedAssignment(
          access: 'RESTRICTED',
          id: a.id,
          shipmentId: a.shipmentId,
          generation: a.generation,
          leaseGeneration: a.leaseGeneration,
          shipmentVersion: a.shipmentVersion,
          custodyPhase: screen == 'R09' ? 'PREPICKUP' : 'PICKED_UP',
          reason: 'DRIVER_SUSPENDED',
        ),
      ));
      await tester.pumpAndSettle();
      expect(find.byType(FoodNavigationMap), findsNothing);
      expect(find.byType(DriverAssignedNavigationCard), findsNothing);
      expect(find.textContaining(metric), findsNothing);
      expect(find.text(a.recipientName), findsNothing);
      expect(find.text(a.addressText), findsNothing);
      expect(find.byKey(ValueKey('food-assigned-arrive-$stage')), findsNothing);
      expect(native.positions.hasListener, isFalse);
      expect(api.submitted, isEmpty);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pumpAndSettle();
    });
  }
  for (final screen in ['R09', 'R12']) {
    for (final thai in [false, true]) {
      for (final large in [false, true]) {
        testWidgets('$screen full marker is visible outside notices TH=$thai large=$large', (tester) async {
          final api = AssignedNavigationApi()..current = surfaceWork(screen, thai);
          await mountAssignedSurface(tester, api, screen, thai: thai, width: large ? 320 : 390, textScale: large ? 1.5 : 1);
          void expectVisibleMarker() {
            final marker = find.ancestor(of: find.byIcon(Icons.delivery_dining), matching: find.byType(DecoratedBox)).first;
            final box = tester.renderObject<RenderBox>(marker);
            final painted = Rect.fromPoints(box.localToGlobal(Offset.zero), box.localToGlobal(box.size.bottomRight(Offset.zero)));
            final panel = find.ancestor(
              of: find.textContaining('AVD /'),
              matching: find.byType(Material),
            ).first;
            expect(painted.overlaps(tester.getRect(panel)), isFalse, reason: 'The full rider marker must remain outside the painted status and provenance panel');
            final viewport = tester.getRect(find.byType(InteractiveViewer));
            expect(viewport.contains(painted.topLeft) && viewport.contains(painted.bottomRight), isTrue);
          }
          expectVisibleMarker();
          await tester.tap(find.byTooltip(thai ? 'โหลดเส้นทางใหม่' : 'Refresh route'));
          await tester.pumpAndSettle();
          expectVisibleMarker();
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
          await tester.pumpAndSettle();
        });
      }
    }
  }
  for (final initialWidth in [390.0, 1440.0]) {
    testWidgets('travel camera keeps world focus across desktop pans from $initialWidth', (tester) async {
      final api = AssignedNavigationApi()..current = surfaceWork('R12', false);
      await mountAssignedSurface(tester, api, 'R12', width: initialWidth);
      final viewer = find.byType(InteractiveViewer);
      Offset focus() {
        final widget = tester.widget<InteractiveViewer>(viewer);
        final viewport = tester.getRect(viewer);
        final panel = find.ancestor(of: find.textContaining('AVD /'), matching: find.byType(Material)).first;
        final availableAnchor = (tester.getTopLeft(panel).dy - viewport.top - 24).clamp(24.0, viewport.height / 2);
        return widget.transformationController!.toScene(Offset(viewport.width / 2, availableAnchor));
      }
      Future<void> pan(Offset delta) async {
        await tester.timedDragFrom(tester.getTopLeft(viewer) + const Offset(100, 80), delta, const Duration(milliseconds: 400));
        await tester.pumpAndSettle();
      }
      if (initialWidth == 390) {
        await pan(const Offset(48, 0));
      }
      final before = focus();
      tester.view.physicalSize = const Size(1440, 844);
      await tester.pumpAndSettle();
      expect((focus() - before).distance, lessThan(.1));
      final wideFocus = focus();
      await pan(const Offset(0, 48));
      expect(focus().dx, closeTo(wideFocus.dx, .1), reason: 'Vertical pan must not reset horizontal world focus');
      final beforeHorizontal = focus();
      await pan(const Offset(-48, 0));
      expect((focus().dx - beforeHorizontal.dx).abs(), greaterThan(1), reason: 'Desktop camera must permit horizontal exploration');
      final afterPan = focus();
      tester.view.physicalSize = const Size(390, 844);
      await tester.pumpAndSettle();
      expect((focus() - afterPan).distance, lessThan(.1));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
      await tester.pumpAndSettle();
    });
  }
}
