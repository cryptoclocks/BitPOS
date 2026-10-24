import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/food_idle_location_controller.dart';
class IdleNative extends GeolocatorPlatform{
 final points=StreamController<Position>.broadcast(),services=StreamController<ServiceStatus>.broadcast();
 @override Future<bool> isLocationServiceEnabled()async=>true;
 @override Future<LocationPermission> checkPermission()async=>LocationPermission.whileInUse;
 @override Stream<Position> getPositionStream({LocationSettings? locationSettings})=>points.stream;
 @override Stream<ServiceStatus> getServiceStatusStream()=>services.stream;
}
class IdleApi extends MobileApi{
 IdleApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 bool owned=true;String revision='1';String? expiresAt;Completer<FoodDiscoveryLocationReceipt>? held;final uploads=<FoodDiscoveryLocationCommand>[];
 @override Future<FoodDiscoverySnapshot> foodDiscovery()async=>FoodDiscoverySnapshot(services:[],consent:FoodDiscoveryConsentState(revision:revision,enabled:true,ownedBySession:owned,expiresAt:expiresAt??DateTime.now().add(const Duration(hours:1)).toUtc().toIso8601String(),location:null));
 @override Future<FoodDiscoveryLocationReceipt> uploadFoodIdleLocation(FoodDiscoveryLocationCommand command)async{uploads.add(command);return held==null?FoodDiscoveryLocationReceipt(sequence:command.sequence,receivedAt:DateTime.now().toUtc().toIso8601String(),replayed:false):held!.future;}
}
Position point()=>Position(latitude:13.756,longitude:100.5018,timestamp:DateTime.now(),accuracy:5,altitude:0,altitudeAccuracy:0,heading:0,headingAccuracy:0,speed:0,speedAccuracy:0);
Future<void> flush()async{await Future<void>.delayed(Duration.zero);await Future<void>.delayed(Duration.zero);}
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();late GeolocatorPlatform previous;late IdleNative native;late IdleApi api;late FoodIdleLocationController controller;
 setUp((){previous=GeolocatorPlatform.instance;native=IdleNative();GeolocatorPlatform.instance=native;api=IdleApi();controller=FoodIdleLocationController(api);});
 tearDown(()async{await controller.stop();controller.dispose();api.close();await native.points.close();await native.services.close();GeolocatorPlatform.instance=previous;});
 test('native fixes upload only opted-in epoch, rate limit bursts and stop on service loss',()async{
  await controller.start('1');native.points.add(point());await flush();expect(api.uploads.single.revision,'1');expect(api.uploads.single.latitudeE7,137560000);expect(api.uploads.single.longitudeE7,1005018000);expect(api.uploads.single.accuracyMm,5000);expect(controller.lastReceivedAt,isNotNull);
  native.points.add(point());await flush();expect(api.uploads.length,1);
  native.services.add(ServiceStatus.disabled);await flush();expect(controller.sharing,isFalse);expect(controller.error,'LOCATION_SERVICE_DISABLED');native.points.add(point());await flush();expect(api.uploads.length,1);
 });
 test('foreign consent owner cannot start native location capture',()async{api.owned=false;await expectLater(controller.start('1'),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','ASSIGNMENT_CHANGED')));native.points.add(point());await flush();expect(api.uploads,isEmpty);expect(controller.sharing,isFalse);});
 test('late upload acknowledgement cannot restore stopped or replacement capture state',()async{
  api.held=Completer<FoodDiscoveryLocationReceipt>();await controller.start('1');native.points.add(point());await flush();expect(api.uploads.length,1);await controller.stop();api.held!.complete(FoodDiscoveryLocationReceipt(sequence:'1',receivedAt:DateTime.now().toUtc().toIso8601String(),replayed:false));await flush();expect(controller.sharing,isFalse);expect(controller.lastReceivedAt,isNull);
 });
 testWidgets('consent expiry stops both native streams without another fix and fences later fixes',(tester)async{
  api.expiresAt=DateTime.now().add(const Duration(seconds:1)).toUtc().toIso8601String();await controller.start('1');expect(native.points.hasListener,true);expect(native.services.hasListener,true);
  await tester.pump(const Duration(seconds:2));expect(controller.sharing,false);expect(controller.error,'LOCATION_CONSENT_EXPIRED');expect(native.points.hasListener,false);expect(native.services.hasListener,false);
  native.points.add(point());await tester.pump();expect(api.uploads,isEmpty);
 });
 testWidgets('superseded consent deadline cannot stop replacement epoch',(tester)async{
  api.expiresAt=DateTime.now().add(const Duration(seconds:1)).toUtc().toIso8601String();await controller.start('1');api.revision='2';api.expiresAt=null;await tester.runAsync(()=>controller.start('2'));await tester.pump(const Duration(seconds:2));expect(controller.sharing,true);
  native.points.add(point());await tester.runAsync(flush);await tester.pump();expect(api.uploads.single.revision,'2');await tester.runAsync(controller.stop);
 });
 test('service-status native error is handled and stops all capture before another upload',()async{
  await controller.start('1');native.services.addError(StateError('fixture native service observer failed'));await flush();expect(controller.sharing,false);expect(controller.error,'LOCATION_SERVICE_UNAVAILABLE');expect(native.points.hasListener,false);expect(native.services.hasListener,false);native.points.add(point());await flush();expect(api.uploads,isEmpty);
 });
}
