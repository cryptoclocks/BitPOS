// Native composition evidence only: original synthetic routes/tiles, no backend,
// real GPS, custody, payment or delivery commands.
import 'package:bitpos_driver/presentation/driver_navigation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:mobile_shared/food_navigation_map.dart';

import '../test/food_realtime_lifecycle_test.dart' as native_fixture;
import '../test/surface_driver_food_ui_test.dart' as surface;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  for (final thai in [false, true]) {
    for (final screen in ['R09', 'R12']) {
      testWidgets('$screen assigned navigation ${thai ? 'TH' : 'EN'} native fixture', (tester) async {
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
        debugPrint('BITPOS_RIDER_NAVIGATION_${screen}_${thai ? 'TH' : 'EN'}_MAP');
        await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
        await surface.revealAssignedTarget(tester,
          find.byKey(const ValueKey('food-assigned-navigation-actions')));
        expect(find.byKey(ValueKey('food-assigned-arrive-${screen == 'R09' ? 'PICKUP' : 'DROPOFF'}')).hitTestable(), findsOneWidget);
        debugPrint('BITPOS_RIDER_NAVIGATION_${screen}_${thai ? 'TH' : 'EN'}_ACTIONS');
        await tester.runAsync(() => Future<void>.delayed(const Duration(seconds: 2)));
        await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
        await tester.pumpAndSettle();
      });
    }
  }
}
