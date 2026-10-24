import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets(
    'assigned customer renders authorized synthetic provider tiles and route',
    (tester) async {
      if (!const bool.fromEnvironment('BITPOS_FIXTURE')) {
        throw StateError('Explicit fixture required');
      }
      const orderId = String.fromEnvironment('BITPOS_TEST_ORDER_ID');
      const shipmentId = String.fromEnvironment('BITPOS_TEST_SHIPMENT_ID');
      const assignmentId = String.fromEnvironment('BITPOS_TEST_ASSIGNMENT_ID');
      const generation = String.fromEnvironment('BITPOS_TEST_GENERATION');
      const leaseGeneration = String.fromEnvironment(
        'BITPOS_TEST_LEASE_GENERATION',
      );
      final customerStorage = FlutterSecureStorage(
        aOptions: AndroidOptions(
          storageNamespace:
              'bitpos_nav_customer_${DateTime.now().microsecondsSinceEpoch}',
        ),
      );
      final driverStorage = FlutterSecureStorage(
        aOptions: AndroidOptions(
          storageNamespace:
              'bitpos_nav_driver_${DateTime.now().microsecondsSinceEpoch}',
        ),
      );
      MobileApi api(FlutterSecureStorage storage) => MobileApi(
        base: Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),
        fixture: true,
        storage: storage,
      );
      final customer = api(customerStorage), driver = api(driverStorage);
      try {
        await customer.restore();
        await customer.verifyOtp('+66900000001', '123456');
        await driver.restore();
        await driver.verifyOtp('+66900000002', '123456');
        // A driver's current marketplace eligibility may expire after an
        // assignment is accepted. The customer's live tracking authorization
        // must continue to follow the existing shipment and lease; do not
        // create/reassign work just to make this visual fixture pass.
        final initialTracking = await customer.foodTracking(shipmentId);
        final initialAssignment = initialTracking.assignment;
        if (initialAssignment == null) {
          throw StateError(
            'Navigation fixture requires a persisted assignment',
          );
        }
        expect(initialAssignment.assignmentId, assignmentId);
        expect(initialAssignment.generation, generation);
        expect(initialAssignment.leaseGeneration, leaseGeneration);
        final upload = await driver.uploadFoodLocation(
          assignmentId,
          FoodLocationCommand(
            generation: generation,
            leaseGeneration: leaseGeneration,
            sequence: DateTime.now().millisecondsSinceEpoch.toString(),
            capturedAt: DateTime.now().toUtc().toIso8601String(),
            latitudeE7: 137592000,
            longitudeE7: 1005050000,
            accuracyMm: 5000,
            headingMdeg: null,
            speedMmS: null,
          ),
        );
        final tracking = await customer.foodTracking(shipmentId),
            assignment = tracking.assignment;
        if (assignment == null) {
          throw StateError('Customer tracking lost the assigned shipment');
        }
        expect(assignment.location!.sequence, upload.sequence);
        expect(assignment.location, isNotNull);
        var selectedNavigation = -1;
        await tester.pumpWidget(
          MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: BitPosTheme.light(),
            home: FoodDeliveryPage(
              api: customer,
              orderId: orderId,
              thai: false,
              onAuthenticationRequired: () =>
                  throw StateError('Unexpected auth loss'),
              onNavigationSelected: (index) => selectedNavigation = index,
            ),
          ),
        );
        expect(find.text('Food on the way'), findsOneWidget);
        expect(
          tester
              .widget<NavigationBar>(find.byType(NavigationBar))
              .selectedIndex,
          1,
        );
        await tester.tap(find.text('Orders'));
        expect(selectedNavigation, 1);
        final decoded = find.byWidgetPredicate(
          (widget) => widget is RawImage && widget.image != null,
        );
        final deadline = DateTime.now().add(const Duration(seconds: 40));
        while ((find.text('Estimated 2 min · 0.5 km').evaluate().isEmpty ||
                decoded.evaluate().length < 9) &&
            DateTime.now().isBefore(deadline)) {
          await tester.pump(const Duration(milliseconds: 200));
        }
        await tester.pumpAndSettle();
        expect(find.text('Estimated 2 min · 0.5 km'), findsOneWidget);
        expect(decoded, findsNWidgets(9));
        expect(find.byType(LinearProgressIndicator), findsNothing);
        expect(find.text('Synthetic BitPOS map tile fixture'), findsOneWidget);
        expect(
          find.text('Synthetic grid map; not real streets'),
          findsOneWidget,
        );
        expect(find.text('Synthetic BitPOS route fixture'), findsOneWidget);
        expect(
          find.text('AVD / SYNTHETIC FIXTURE — not real GPS or delivery'),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
        final map = find.byType(InteractiveViewer),
            driverMarker = find.descendant(
              of: map,
              matching: find.byIcon(Icons.delivery_dining),
            ),
            destination = find.descendant(
              of: map,
              matching: find.byIcon(Icons.flag),
            );
        final beforeZoom =
            (tester.getCenter(destination) - tester.getCenter(driverMarker))
                .distance;
        expect(beforeZoom, greaterThan(6));
        await tester.tap(find.byTooltip('Zoom in'));
        await tester.pump();
        final zoomDeadline = DateTime.now().add(const Duration(seconds: 20));
        while ((decoded.evaluate().length < 9 ||
                find.byType(LinearProgressIndicator).evaluate().isNotEmpty) &&
            DateTime.now().isBefore(zoomDeadline)) {
          await tester.pump(const Duration(milliseconds: 200));
        }
        await tester.pumpAndSettle();
        expect(decoded, findsNWidgets(9));
        expect(find.byType(LinearProgressIndicator), findsNothing);
        final afterZoom =
            (tester.getCenter(destination) - tester.getCenter(driverMarker))
                .distance;
        expect(afterZoom, greaterThan(beforeZoom * 1.8));
        final receipt = {
          'status': 'PASS_BOUNDED_AVD_ASSIGNED_NAVIGATION',
          'fixture': true,
          'orderId': orderId,
          'assignmentId': assignment.assignmentId,
          'generation': assignment.generation,
          'leaseGeneration': assignment.leaseGeneration,
          'acknowledgedSequence': assignment.location!.sequence,
          'tileImages': 9,
          'estimatedFixtureSeconds': 120,
          'markerDistanceBeforeZoom': beforeZoom,
          'markerDistanceAfterZoom': afterZoom,
          'physicalTesting': 'deferred_by_user_2026-10-16',
          'limits': [
            'Synthetic grid/straight-line route/ETA; not real streets or real-provider readiness',
            'No physical GPS/driving',
            'Not full platform or fidelity acceptance',
          ],
        };
        await File('${Directory.systemTemp.path}/bitpos-navigation070.json')
            .writeAsString(jsonEncode(receipt), flush: true);
        debugPrint('BITPOS_NAVIGATION070_RENDERED');
        await tester.pump(const Duration(seconds: 3));
      } finally {
        await tester.pumpWidget(const MaterialApp(home: SizedBox()));
        await tester.pumpAndSettle();
        for (final api in [customer, driver]) {
          if (api.signedIn) await api.logout();
          api.close();
        }
        await customerStorage.deleteAll();
        await driverStorage.deleteAll();
      }
    },
  );
}
