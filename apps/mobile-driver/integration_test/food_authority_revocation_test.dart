import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_navigation_map.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/food_work_page.dart';

void main(){
 final binding=IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('real assigned GPS and open proof are removed on live authority revocation',(tester)async{
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit local fixture required');
  final session=jsonDecode(utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))));
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session),'bitpos.deviceId':'00000000-0000-4000-8000-000000000078'});
  final api=MobileApi(base:Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),fixture:true);await api.restore();addTearDown(api.close);expect(api.signedIn,isTrue);
  final initial=await api.foodDriverWork(),a=initial.assignment;if(a is! FoodDriverAssignment)throw StateError('Normal retained fixture assignment required');expect(a.state,'AT_PICKUP');expect(a.proofs,isNotEmpty);
  Future<void> until(bool Function() condition)async{final deadline=DateTime.now().add(const Duration(seconds:45));while(!condition()&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:100));}expect(condition(),isTrue);}
  await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:FoodWorkPage(api:api,thai:false)));
  await until(()=>find.byType(ListView).evaluate().isNotEmpty);debugPrint('BITPOS_AUTHORITY078_READY');
  final permissionDeadline=DateTime.now().add(const Duration(seconds:45));var permission=await Geolocator.checkPermission();
  while(permission!=LocationPermission.whileInUse&&permission!=LocationPermission.always&&DateTime.now().isBefore(permissionDeadline)){await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:200)));permission=await Geolocator.checkPermission();}
  expect([LocationPermission.whileInUse,LocationPermission.always],contains(permission));
  final gps=find.text('Allow and start assignment GPS');await tester.scrollUntilVisible(gps,250);await tester.ensureVisible(gps);await tester.pumpAndSettle();await tester.tap(gps);await tester.pump();
  FoodTrackedLocation? point;final locationDeadline=DateTime.now().add(const Duration(seconds:45));
  while(point==null&&DateTime.now().isBefore(locationDeadline)){point=(await api.foodTracking(a.shipmentId)).assignment?.location;await tester.pump();if(point==null)await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:500)));}
  expect(point,isNotNull,reason:'Real native injected sample must reach authenticated API before revocation');
  final proof=find.byKey(const ValueKey('food-custody-PICKUP'));await tester.scrollUntilVisible(proof,-250);await tester.ensureVisible(proof);await tester.pumpAndSettle();await tester.tap(proof);await tester.pump(const Duration(milliseconds:300));
  await tester.enterText(find.byType(TextField),'private-unsubmitted-avd-fixture-secret');expect(find.byType(AlertDialog),findsOneWidget);debugPrint('BITPOS_AUTHORITY078_CAPTURED');
  await until(()=>find.byType(AlertDialog).evaluate().isEmpty&&find.byIcon(Icons.shield_outlined).evaluate().isNotEmpty);
  expect(find.text(a.recipientName),findsNothing);expect(find.text(a.phone),findsNothing);expect(find.text(a.addressText),findsNothing);expect(find.byType(FoodNavigationMap),findsNothing);expect(find.byType(TextField),findsNothing);expect(find.byKey(const ValueKey('food-custody-PICKUP')),findsNothing);expect(await api.pendingFoodDispatch(),isNull);
  final restricted=(await api.foodDriverWork()).assignment;expect(restricted,isA<FoodDriverRestrictedAssignment>());expect((restricted as FoodDriverRestrictedAssignment).id,a.id);expect(restricted.custodyPhase,'PREPICKUP');expect(restricted.reason,'DRIVER_SUSPENDED');expect(tester.takeException(),isNull);
  debugPrint('BITPOS_AUTHORITY078_REDACTED');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:4)));
  binding.reportData={'status':'PASS_AVD_LIVE_AUTHORITY_REDACTION','fixture':true,'assignmentId':a.id,'acknowledgedSequence':point!.sequence,'physicalTesting':'deferred_by_user_2026-10-16','limits':['AVD injected GPS, not real driving or battery proof','Synthetic secure-storage session only; actual HTTP/SSE/native GPS/journal','No support resolution or reassignment claim']};
 });
}
