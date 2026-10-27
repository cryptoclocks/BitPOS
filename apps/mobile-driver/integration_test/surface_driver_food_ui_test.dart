// Native UI-only fixture batch. Never calls a backend, starts GPS or submits work.
import 'package:bitpos_driver/presentation/driver_navigation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';

import '../test/food_realtime_lifecycle_test.dart' as native_fixture;
import '../test/surface_driver_food_ui_test.dart' as surface;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  for (final screen in ['R06', 'R07', 'R08', 'R11', 'R13']) {
    testWidgets('$screen native local UI fixture', (tester) async {
      final previous = GeolocatorPlatform.instance;
      final native = native_fixture.ActiveNative();
      GeolocatorPlatform.instance = native;
      final api = surface.SurfaceWorkApi()
        ..current = surface.surfaceWork(screen, true);
      addTearDown(() {
        api.close();
        native.close();
        GeolocatorPlatform.instance = previous;
      });
      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: BitPosTheme.light(),
          home: DriverDestination(
            thai: true,
            index: 0,
            child: surface.surfacePage(api, screen, true),
          ),
        ),
      );
      await tester.pumpAndSettle();
      if (screen == 'R07') {
        await surface.revealSurfaceOffer(tester, true);
      }
      if (screen == 'R11' || screen == 'R13') {
        expect(
          find
              .byKey(
                ValueKey(
                  'food-custody-${screen == 'R11' ? 'PICKUP' : 'DELIVERY'}',
                ),
              )
              .hitTestable(),
          findsOneWidget,
        );
      }
      expect(tester.takeException(), isNull);
      expect(api.submitted, isEmpty);
      expect(native.positions.hasListener, isFalse);
      debugPrint(
        'RIDER_SURFACE_NATIVE_VIEW $screen ${tester.view.physicalSize} DPR=${tester.view.devicePixelRatio}',
      );
      debugPrint('RIDER_SURFACE_NATIVE_READY $screen');
      // Keep the real native frame available to a host-side adb capture.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(seconds: 2)),
      );
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      await tester.pumpAndSettle();
    });
  }
}
