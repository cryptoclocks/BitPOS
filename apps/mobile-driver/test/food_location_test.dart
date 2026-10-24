import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/food_location_controller.dart';
import 'package:bitpos_driver/food_work_page.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
class NativeFixture extends GeolocatorPlatform {
 LocationPermission permission=LocationPermission.whileInUse;
 Stream<Position> positionStream=const Stream.empty();
 @override Future<bool> isLocationServiceEnabled() async=>true;
 @override Future<LocationPermission> checkPermission() async=>permission;
 @override Stream<Position> getPositionStream({LocationSettings? locationSettings})=>positionStream;
 @override Stream<ServiceStatus> getServiceStatusStream()=>const Stream.empty();
}
class LocationApi extends MobileApi {
 LocationApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 @override Stream<FoodRealtimeState<FoodDriverRealtimeSnapshot>> watchFoodWork()=>const Stream.empty();
 @override Future<FoodTrackingSnapshot> foodTracking(String shipmentId) async {
  if(shipmentId==first)await Future<void>.delayed(const Duration(milliseconds:10));
  return FoodTrackingSnapshot(assignment:FoodTrackedAssignment(assignmentId:shipmentId,generation:'1',leaseGeneration:'1',location:FoodTrackedLocation.fromJson({'sequence':'1','latitudeE7':137560000,'longitudeE7':1005018000,'accuracyMm':5000,'capturedAt':shipmentId==first?'2026-10-18T00:00:00Z':'2026-10-18T01:00:00Z','receivedAt':shipmentId==first?'2026-10-18T00:00:00Z':'2026-10-18T01:00:00Z','stale':false})));
 }
}
class WorkApi extends LocationApi {
 final submitted=<FoodDispatchMutation>[];
 @override Future<Object> submitFoodDispatch(FoodDispatchMutation command) async{submitted.add(command);throw StateError('Canceled proof must not submit custody');}
 @override Future<FoodDispatchMutation?> pendingFoodDispatch() async=>null;
 @override Future<FoodDriverWork> foodDriverWork() async=>FoodDriverWork(offers:[],assignment:FoodDriverAssignment.fromJson({...job(first).toJson(),'state':'AT_PICKUP','proofs':[{'id':second,'kind':'PICKUP','expiresAt':DateTime.now().add(const Duration(minutes:5)).toUtc().toIso8601String(),'attemptsRemaining':10}]}));
}
FoodDriverAssignment job(String id)=>FoodDriverAssignment(access:'NORMAL',shipmentVersion:'1',id:id,shipmentId:id,orderId:id,merchantId:id,generation:'1',leaseGeneration:'1',state:'ACCEPTED',pickupLatitudeE7:137560000,pickupLongitudeE7:1005018000,recipientName:'Fixture',phone:'+66900000001',addressText:'Fixture',instructions:'',latitudeE7:137560001,longitudeE7:1005018001,earning:MobileMoney(currency:'USD',decimals:2,amountMinor:'100'),fixture:true,proofs:[]);
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 late GeolocatorPlatform previous;late NativeFixture native;late LocationApi api;late FoodLocationController controller;
 setUp((){previous=GeolocatorPlatform.instance;native=NativeFixture();GeolocatorPlatform.instance=native;api=LocationApi();controller=FoodLocationController(api);});
 test('fresh receive time cannot make an aged capture look current',(){
  controller.lastReceivedAt=DateTime.now();controller.lastCapturedAt=DateTime.utc(2000);
  expect(controller.acknowledgedFixStale,isTrue);
  controller.lastCapturedAt=DateTime.now();expect(controller.acknowledgedFixStale,isFalse);
  controller.lastReceivedAt=DateTime.utc(2000);expect(controller.acknowledgedFixStale,isTrue);
 });
 tearDown((){controller.dispose();api.close();GeolocatorPlatform.instance=previous;});
 testWidgets('canceling custody entry keeps pickup actionable after dialog exit animation',(tester) async{
  final workApi=WorkApi();addTearDown(workApi.close);
  await tester.pumpWidget(MaterialApp(home:FoodWorkPage(api:workApi,thai:false)));await tester.pumpAndSettle();
  final custody=find.byKey(const ValueKey('food-custody-PICKUP'));await tester.scrollUntilVisible(custody,300);await tester.ensureVisible(custody);await tester.pumpAndSettle();await tester.tap(custody);await tester.pump();await tester.pump(const Duration(milliseconds:300));
  await tester.enterText(find.byType(TextField),'fixture-unsubmitted-secret');await tester.tap(find.text('Cancel'));await tester.pumpAndSettle();
  expect(find.text('Food custody proof'),findsNothing);expect(tester.widget<FilledButton>(custody).onPressed,isNotNull);expect(workApi.submitted,isEmpty);expect(tester.takeException(),isNull);
  await tester.pumpWidget(const MaterialApp());
 });
 test('overlapping starts cannot replace winning assignment acknowledgement with older snapshot',() async{
  await Future.wait([controller.start(job(first)),controller.start(job(second))]);
  expect(controller.sharing,isTrue);expect(controller.lastReceivedAt,DateTime.parse('2026-10-18T01:00:00Z'));
  await controller.stop();expect(controller.lastReceivedAt,isNull);expect(controller.lastCapturedAt,isNull);expect(controller.sharing,isFalse);
 });
 test('overlapping native stop retains a real cancellation failure across later stop and restart',()async{
  final cancelled=Completer<void>();final positions=StreamController<Position>(onCancel:()=>cancelled.future);native.positionStream=positions.stream;
  await controller.start(job(second));final firstStop=controller.stop(),secondStop=controller.stop();
  cancelled.completeError(StateError('Fixture native cancellation failed'));await Future.wait([firstStop,secondStop]);
  expect(controller.sharing,isFalse);expect(controller.error,'LOCATION_STOP_UNCONFIRMED');
  await controller.stop();expect(controller.error,'LOCATION_STOP_UNCONFIRMED');
  await expectLater(controller.start(job(second)),throwsA(isA<MobileApiException>().having((value)=>value.code,'code','LOCATION_STOP_UNCONFIRMED')));
 });
 test('settings return refreshes current permission instead of retaining previous grant',() async{
  native.permission=LocationPermission.always;await controller.refreshPermissions();expect(controller.backgroundAuthorized,isTrue);
  native.permission=LocationPermission.denied;await controller.refreshPermissions();expect(controller.backgroundAuthorized,isFalse);expect(controller.serviceEnabled,isTrue);
 });
}
