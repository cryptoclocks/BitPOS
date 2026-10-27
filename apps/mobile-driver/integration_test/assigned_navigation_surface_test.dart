// Native composition evidence only: original synthetic routes/tiles, no backend,
// real GPS, custody, payment or delivery commands.
import 'dart:convert';
import 'dart:io';

import 'package:bitpos_driver/presentation/driver_navigation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/food_navigation_map.dart';

import '../test/food_realtime_lifecycle_test.dart' as native_fixture;
import '../test/surface_driver_food_ui_test.dart' as surface;

Object? _captureAcknowledgementFailure;

void _throwIfCaptureAcknowledgementFailed() {
  final failure = _captureAcknowledgementFailure;
  if (failure != null) throw StateError('Previous capture acknowledgement failed');
}

Future<void> acknowledgeCapture(String stage) async {
  const endpoint = String.fromEnvironment('BITPOS_RIDER_CAPTURE_ACK');
  if (endpoint.isEmpty) {
    throw StateError('Capture acknowledgement endpoint is required');
  }

  const timeout = Duration(seconds: 15);
  final elapsed = Stopwatch()..start();
  void trace(String event, [Object? error]) {
    debugPrint(
      'BITPOS_RIDER_CAPTURE_CLIENT ${jsonEncode({
        'stage': stage,
        'event': event,
        'elapsedMs': elapsed.elapsedMilliseconds,
        if (error != null) 'exceptionType': error.runtimeType.toString(),
      })}',
    );
  }

  final uri = Uri.parse(endpoint).replace(path: '/$stage');
  final client = HttpClient()..connectionTimeout = timeout;
  try {
    trace('started');
    final request = await client.postUrl(uri).timeout(timeout);
    final response = await request.close().timeout(timeout);
    trace('responseHeaders');
    await response.drain<void>().timeout(timeout);
    trace('finished');
    if (response.statusCode != HttpStatus.noContent) {
      throw StateError('Capture acknowledgement failed for $stage');
    }
  } catch (error) {
    _captureAcknowledgementFailure = error;
    trace('error', error);
    rethrow;
  } finally {
    client.close(force: true);
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  for (final thai in [false, true]) {
    for (final screen in ['R09', 'R12']) {
      testWidgets('$screen assigned navigation ${thai ? 'TH' : 'EN'} native fixture', (tester) async {
        _throwIfCaptureAcknowledgementFailed();
        await surface.loadSurfaceNavigationTile();
        final previous = GeolocatorPlatform.instance;
        final native = native_fixture.ActiveNative();
        final api = surface.AssignedNavigationApi()
          ..current = surface.surfaceWork(screen, thai);
        GeolocatorPlatform.instance = native;
        addTearDown(() {
          api.close();
          native.close();
          GeolocatorPlatform.instance = previous;
        });
        final travelMode = ValueNotifier(false);
        addTearDown(travelMode.dispose);
        await tester.pumpWidget(MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: BitPosTheme.light(),
          home: DriverDestination(
            thai: thai,
            index: 0,
            travelMode: travelMode,
            child: surface.surfacePage(api, screen, thai, onTravelModeChanged: (value) => travelMode.value = value),
          ),
        ));
        await tester.pumpAndSettle();
        expect(find.byType(FoodNavigationMap), findsOneWidget);
        expect(find.byType(Image), findsNWidgets(9));
        expect(find.byType(InteractiveViewer), findsOneWidget);
        expect(tester.takeException(), isNull);
        expect(find.byType(DriverNavigation), findsNothing);
        expect(api.submitted, isEmpty);
        await tester.runAsync(
          () => acknowledgeCapture('${screen}_${thai ? 'TH' : 'EN'}_MAP'),
        );
        debugPrint('BITPOS_RIDER_NAVIGATION_${screen}_${thai ? 'TH' : 'EN'}_MAP');
        final arrive = find.byKey(
          ValueKey(
            'food-assigned-arrive-${screen == 'R09' ? 'PICKUP' : 'DROPOFF'}',
          ),
        );
        await surface.revealAssignedTarget(
          tester,
          find.byKey(const ValueKey('food-assigned-navigation-actions')),
        );
        await tester.ensureVisible(arrive);
        await tester.pumpAndSettle();
        expect(arrive.hitTestable(), findsOneWidget);
        await tester.runAsync(
          () => acknowledgeCapture('${screen}_${thai ? 'TH' : 'EN'}_ACTIONS'),
        );
        debugPrint('BITPOS_RIDER_NAVIGATION_${screen}_${thai ? 'TH' : 'EN'}_ACTIONS');
        await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
        await tester.pumpAndSettle();
      });
    }
  }
  for (final thai in [false, true]) {
    testWidgets('R08 assigned job details ${thai ? 'TH' : 'EN'} native fixture', (tester) async {
      _throwIfCaptureAcknowledgementFailed();
      await surface.loadSurfaceNavigationTile();
      final previous = GeolocatorPlatform.instance;
      final native = native_fixture.ActiveNative();
      final api = surface.AssignedNavigationApi()
        ..current = surface.surfaceWork('R08', thai);
      GeolocatorPlatform.instance = native;
      addTearDown(() {
        api.close();
        native.close();
        GeolocatorPlatform.instance = previous;
      });
      final travelMode = ValueNotifier(false);
      addTearDown(travelMode.dispose);
      await tester.pumpWidget(MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: BitPosTheme.light(),
        home: DriverDestination(
          thai: thai,
          index: 0,
          travelMode: travelMode,
          child: surface.surfacePage(
            api,
            'R08',
            thai,
            onTravelModeChanged: (value) => travelMode.value = value,
          ),
        ),
      ));
      await tester.pumpAndSettle();
      final details = find.byKey(
        const ValueKey('food-assigned-navigation-details'),
      );
      await surface.revealAssignedTarget(tester, details);
      await tester.tap(details);
      await tester.pumpAndSettle();
      expect(find.byType(DriverNavigation), findsOneWidget);
      expect(find.byType(FoodNavigationMap), findsNothing);
      expect(
        find.byKey(const ValueKey('food-assigned-arrive-PICKUP')),
        findsNothing,
      );
      expect(native.positions.hasListener, isFalse);
      expect(api.submitted, isEmpty);
      await tester.runAsync(
        () => acknowledgeCapture('R08_${thai ? 'TH' : 'EN'}_DETAILS'),
      );
      debugPrint('BITPOS_RIDER_NAVIGATION_R08_${thai ? 'TH' : 'EN'}_DETAILS');
      final continueNavigation = find.byKey(
        const ValueKey('food-assigned-continue-navigation'),
      );
      await tester.ensureVisible(continueNavigation);
      await tester.pumpAndSettle();
      expect(continueNavigation.hitTestable(), findsOneWidget);
      await tester.tap(continueNavigation);
      await tester.pumpAndSettle();
      expect(find.byType(DriverNavigation), findsNothing);
      expect(find.byType(FoodNavigationMap), findsOneWidget);
      expect(api.submitted, isEmpty);
      expect(native.positions.hasListener, isFalse);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
      await tester.pumpAndSettle();
    });
  }
}
