// Actual FoodWorkPage on the authorized Android emulator. Local API/native
// fixtures only: not real dispatch, payment, GPS, or physical-device evidence.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import '../test/food_realtime_lifecycle_test.dart' as fixture;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('assigned job recipient is selectable and retired on restriction', (tester) async {
    final previous = GeolocatorPlatform.instance;
    final native = fixture.ActiveNative();
    GeolocatorPlatform.instance = native;
    final api = fixture.LiveWorkApi()..current = fixture.work(name: 'Local fixture recipient');
    addTearDown(() { api.close(); native.close(); GeolocatorPlatform.instance = previous; });
    final assignment = api.current.assignment as FoodDriverAssignment;
    await fixture.mount(tester, api);
    final phone = find.text(assignment.phone);
    await tester.scrollUntilVisible(phone, 300);
    await tester.ensureVisible(phone);
    await tester.pumpAndSettle();
    expect(phone.hitTestable(), findsOneWidget);
    await tester.longPress(phone);
    await tester.pumpAndSettle();
    expect(find.text('Copy'), findsOneWidget);
    debugPrint('BITPOS_R08_NATIVE_RECIPIENT_SELECTION_READY');
    api.publish(FoodDriverWork(offers: [], assignment: FoodDriverRestrictedAssignment(
      access: 'RESTRICTED', id: assignment.id, shipmentId: assignment.shipmentId,
      generation: assignment.generation, leaseGeneration: assignment.leaseGeneration,
      shipmentVersion: assignment.shipmentVersion, custodyPhase: 'PREPICKUP', reason: 'DRIVER_SUSPENDED',
    )));
    await tester.pumpAndSettle();
    expect(find.text(assignment.recipientName), findsNothing);
    expect(phone, findsNothing);
    expect(find.text('Copy'), findsNothing);
    expect(api.submitted, isEmpty);
    debugPrint('BITPOS_R08_NATIVE_PRIVATE_DETAILS_RETIRED');
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
  });
}
