import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_navigation_map.dart';
import 'food_realtime_lifecycle_test.dart' as fixture;
import 'package:bitpos_driver/food_location_controller.dart';

const privateName='Private authority regression recipient';
FoodDriverWork restricted()=>FoodDriverWork(offers:[],assignment:FoodDriverRestrictedAssignment(access:'RESTRICTED',id:'11111111-1111-4111-8111-111111111111',shipmentId:'11111111-1111-4111-8111-111111111111',generation:'1',leaseGeneration:'1',shipmentVersion:'4',custodyPhase:'PREPICKUP',reason:'DRIVER_SUSPENDED'));
Position point()=>Position(latitude:13.756,longitude:100.5018,timestamp:DateTime.now(),accuracy:5,altitude:0,altitudeAccuracy:0,heading:0,headingAccuracy:0,speed:0,speedAccuracy:0);
class ControlledNative extends fixture.ActiveNative {
 ControlledNative(this.fail){held=StreamController<Position>(sync:true,onCancel:()=>fail?Future<void>.error(StateError('synthetic native cancellation failed')):cancellation.future);}
 final bool fail;final cancellation=Completer<void>();late final StreamController<Position> held;
 @override Stream<Position> getPositionStream({LocationSettings? locationSettings})=>held.stream;
 @override void close(){if(!cancellation.isCompleted)cancellation.complete();unawaited(held.close());super.close();}
}
class AuthorityApi extends fixture.LiveWorkApi {
 AuthorityApi({this.denial}){current=fixture.work(name:privateName);}
 final String? denial;bool authorityDenied=false;final uploads=<FoodLocationCommand>[];
 Completer<FoodDriverWork>? authorityRecovery;
 @override Future<FoodDriverWork> foodDriverWork()=>authorityDenied?(authorityRecovery?.future??Future.value(restricted())):super.foodDriverWork();
 @override Future<FoodLocationReceipt> uploadFoodLocation(String assignmentId,FoodLocationCommand command)async{
  uploads.add(command);final code=denial;if(code!=null){authorityDenied=code!='DISPATCH_AUTH_RETRY';throw MobileApiException(code,409);}
  return FoodLocationReceipt(sequence:command.sequence,replayed:false,receivedAt:DateTime.now().toUtc().toIso8601String());
 }
}
Future<void> start(WidgetTester tester,AuthorityApi api)async{
 tester.view.physicalSize=const Size(800,2800);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
 await fixture.mount(tester,api);expect(find.text(privateName),findsOneWidget);
 await tester.tap(find.text('Allow and start assignment GPS'));await tester.pumpAndSettle();
}
void privateWorkRetired(WidgetTester tester){expect(find.text(privateName),findsNothing);expect(find.byType(FoodNavigationMap),findsNothing);expect(find.byType(AlertDialog),findsNothing);expect(find.byType(TextField),findsNothing);expect(find.byKey(const ValueKey('food-custody-PICKUP')),findsNothing);expect(find.byIcon(Icons.shield_outlined),findsOneWidget);expect(tester.takeException(),isNull);}
void main(){
 late GeolocatorPlatform previous;late fixture.ActiveNative native;
 setUp((){previous=GeolocatorPlatform.instance;native=fixture.ActiveNative();GeolocatorPlatform.instance=native;});
 tearDown((){native.close();GeolocatorPlatform.instance=previous;});
 test('native cancellation failure remains an explicit unconfirmed stop',()async{
  native.close();final controlled=ControlledNative(true);native=controlled;GeolocatorPlatform.instance=controlled;final api=AuthorityApi();addTearDown(api.close);
  final controller=FoodLocationController(api);addTearDown(controller.dispose);final duty=api.current.assignment;if(duty is! FoodDriverAssignment)throw StateError('Normal fixture required');
  await controller.start(duty);await controller.stop();expect(controller.sharing,false);expect(controller.error,'LOCATION_STOP_UNCONFIRMED');expect(controlled.services.hasListener,false);
 });
 for(final fail in [false,true]){
  testWidgets('restricted duty retires private UI before ${fail?'failed':'held'} native cancellation',(tester)async{
   native.close();final controlled=ControlledNative(fail);native=controlled;GeolocatorPlatform.instance=controlled;
   final api=AuthorityApi();addTearDown(api.close);await start(tester,api);expect(controlled.held.hasListener,true);await fixture.custody(tester);
   api.publish(restricted());await tester.pump(const Duration(milliseconds:350));
   privateWorkRetired(tester);expect(controlled.services.hasListener,false);expect(api.submitted,isEmpty);
   controlled.held.add(point());await tester.pump();expect(api.uploads,isEmpty);
   if(!fail){expect(controlled.cancellation.isCompleted,false);controlled.cancellation.complete();await tester.pump();privateWorkRetired(tester);}
   else{
    // Redaction above must precede native completion; then observe its real-zone failure.
    await tester.runAsync(()=>Future<void>.delayed(Duration.zero));await tester.pump();
    expect(find.textContaining('LOCATION_STOP_UNCONFIRMED'),findsOneWidget);
   }
  });
 }
 for(final code in ['DRIVER_SUSPENDED','DRIVER_VERIFICATION_REQUIRED','DRIVER_DOCUMENT_EXPIRED','DRIVER_UNAVAILABLE']){
  testWidgets('$code stops native capture and redacts private duty without an SSE replacement',(tester)async{
   final api=AuthorityApi(denial:code);addTearDown(api.close);await start(tester,api);expect(native.positions.hasListener,true);
   native.positions.add(point());await tester.pump(const Duration(milliseconds:350));
   privateWorkRetired(tester);expect(native.positions.hasListener,false);expect(native.services.hasListener,false);expect(api.uploads.length,1);expect(api.submitted,isEmpty);
   native.positions.add(point());await tester.pump();expect(api.uploads.length,1);
  });
 }
 testWidgets('custody remains unknown until authoritative recovery after a denial',(tester)async{
  final recovery=Completer<FoodDriverWork>(),api=AuthorityApi(denial:'DRIVER_SUSPENDED')..authorityRecovery=recovery;addTearDown(api.close);addTearDown((){if(!recovery.isCompleted)recovery.complete(restricted());});
  await start(tester,api);native.positions.add(point());await tester.pump(const Duration(milliseconds:350));
  privateWorkRetired(tester);expect(find.textContaining('Food not collected:'),findsNothing,reason:'The last displayed AT_PICKUP snapshot cannot prove pickup did not commit while its response was lost');expect(find.textContaining('Food already collected:'),findsNothing);
  final duty=restricted().assignment!;recovery.complete(FoodDriverWork.fromJson({'offers':[],'assignment':{...duty.toJson(),'custodyPhase':'PICKED_UP','shipmentVersion':'5'}}));await tester.pump(const Duration(milliseconds:350));
  privateWorkRetired(tester);expect(find.textContaining('Food already collected:'),findsOneWidget);expect(api.submitted,isEmpty);
 });
 testWidgets('buffered NORMAL cannot undo confirmed restricted custody without fresh finite recovery',(tester)async{
  final api=AuthorityApi(denial:'DRIVER_SUSPENDED');addTearDown(api.close);await start(tester,api);final old=api.current;
  native.positions.add(point());await tester.pump(const Duration(milliseconds:350));privateWorkRetired(tester);
  final recovery=Completer<FoodDriverWork>();api.authorityRecovery=recovery;addTearDown((){if(!recovery.isCompleted)recovery.complete(restricted());});
  api.publish(old);await tester.pump(const Duration(milliseconds:350));privateWorkRetired(tester);expect(native.positions.hasListener,false);
  recovery.complete(old);await tester.pump(const Duration(milliseconds:350));expect(find.text(privateName),findsOneWidget);expect(find.byIcon(Icons.shield_outlined),findsNothing);expect(tester.takeException(),isNull);
 });
 testWidgets('transient source-lock retry preserves current private duty and capture',(tester)async{
  final api=AuthorityApi(denial:'DISPATCH_AUTH_RETRY');addTearDown(api.close);await start(tester,api);native.positions.add(point());await tester.pump(const Duration(milliseconds:350));
  expect(find.text(privateName),findsOneWidget);expect(native.positions.hasListener,true);expect(native.services.hasListener,true);expect(find.byIcon(Icons.shield_outlined),findsNothing);expect(tester.takeException(),isNull);
 });
}
