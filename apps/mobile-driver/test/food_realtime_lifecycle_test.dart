import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'package:bitpos_driver/food_work_page.dart';
import 'food_location_test.dart' as fixture;
const third='33333333-3333-4333-8333-333333333333';
class ActiveNative extends fixture.NativeFixture {
 final positions=StreamController<Position>.broadcast(sync:true),services=StreamController<ServiceStatus>.broadcast(sync:true);
 @override Stream<Position> getPositionStream({LocationSettings? locationSettings})=>positions.stream;
 @override Stream<ServiceStatus> getServiceStatusStream()=>services.stream;
 void close(){unawaited(positions.close());unawaited(services.close());}
}
FoodDriverWork work({String assignment=fixture.first,String proof=fixture.second,String name='Fixture'})=>FoodDriverWork(offers:[],assignment:FoodDriverAssignment.fromJson({...fixture.job(assignment).toJson(),'recipientName':name,'state':'AT_PICKUP','proofs':[{'id':proof,'kind':'PICKUP','expiresAt':DateTime.now().add(const Duration(minutes:5)).toUtc().toIso8601String(),'attemptsRemaining':10}]}));
class LiveWorkApi extends fixture.WorkApi {
 final updates=StreamController<FoodRealtimeState<FoodDriverRealtimeSnapshot>>.broadcast();
 FoodDriverWork current=work();Completer<FoodDriverWork>? read;bool authenticated=true;
 @override bool get signedIn=>authenticated;
 @override Stream<FoodRealtimeState<FoodDriverRealtimeSnapshot>> watchFoodWork()=>updates.stream;
 @override Future<FoodDriverWork> foodDriverWork()=>read?.future??Future.value(current);
 void publish(FoodDriverWork value){current=value;updates.add(FoodRealtimeLive(FoodDriverRealtimeSnapshot(serverTime:DateTime.now().toUtc().toIso8601String(),cursor:'f1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',work:value,location:null)));}
 @override Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
  submitted.add(command);final a=current.assignment;
  if(a is! FoodDriverAssignment)throw StateError('Normal fixture assignment required');
  current=FoodDriverWork(offers:[],assignment:FoodDriverAssignment.fromJson({...a.toJson(),'state':'PICKED_UP','proofs':[]}));
  return FoodProofAccepted(FoodProofConfirmed(accepted:true,assignmentId:a.id,proofId:(command as FoodConsumeMutation).command.proofId,kind:'PICKUP',consumedAt:DateTime.now().toUtc().toIso8601String(),accrualId:null));
 }
 @override void close(){unawaited(updates.close());super.close();}
}
class WithdrawalApi extends LiveWorkApi {
 @override Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
  if(command is! FoodWithdrawMutation)return super.submitFoodDispatch(command);
  submitted.add(command);final a=current.assignment as FoodDriverAssignment;
  current=FoodDriverWork(offers:[],assignment:null);
  return FoodRecoveryReceipt(assignmentId:a.id,shipmentId:a.shipmentId,generation:a.generation,leaseGeneration:a.leaseGeneration,shipmentGeneration:'2',shipmentVersion:'5',state:'RELEASED',searchEpoch:null,replacementOffer:null);
 }
}
class ConflictedWithdrawalApi extends LiveWorkApi {
 ConflictedWithdrawalApi(this.code);final String code;
 @override Future<Object> submitFoodDispatch(FoodDispatchMutation command)async{
  submitted.add(command);read=Completer<FoodDriverWork>();throw MobileApiException(code,409);
 }
}
Future<void> mount(WidgetTester tester,LiveWorkApi api) async {tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);await tester.pumpWidget(MaterialApp(home:FoodWorkPage(api:api,thai:false)));await tester.pumpAndSettle();}
Future<void> custody(WidgetTester tester) async {final button=find.byKey(const ValueKey('food-custody-PICKUP'));await tester.scrollUntilVisible(button,300);await tester.ensureVisible(button);await tester.pump();await tester.tap(button);await tester.pump(const Duration(milliseconds:300));expect(find.byType(AlertDialog),findsOneWidget);await tester.enterText(find.byType(TextField),'private-fixture-custody-secret-123456');}
void main(){
 late GeolocatorPlatform previous;late ActiveNative native;
 setUp((){previous=GeolocatorPlatform.instance;native=ActiveNative();GeolocatorPlatform.instance=native;});
 tearDown((){native.close();GeolocatorPlatform.instance=previous;});
 testWidgets('confirmed pre-pickup withdrawal retires private duty and rejects buffered old work',(tester)async{
  final api=WithdrawalApi()..current=work(name:'Private withdrawal recipient');addTearDown(api.close);final old=api.current;
  await mount(tester,api);
  final reasons=find.text('Choose reason to request withdrawal');await tester.scrollUntilVisible(reasons,400);await tester.ensureVisible(reasons);await tester.pumpAndSettle();expect(reasons.hitTestable(),findsOneWidget);await tester.tap(reasons);await tester.pumpAndSettle();
  await tester.tap(find.text('Safety'));await tester.pumpAndSettle();
  expect(api.submitted.single,isA<FoodWithdrawMutation>().having((value)=>value.command.reason,'reason','SAFETY'));
  expect(find.text('Private withdrawal recipient'),findsNothing);
  api.publish(old);await tester.pumpAndSettle();
  expect(find.text('Private withdrawal recipient'),findsNothing);
  expect(find.byKey(const ValueKey('food-withdrawal-confirmed')),findsOneWidget);expect(tester.takeException(),isNull);
 });
 for(final code in ['VERSION_CONFLICT','CUSTODY_RETAINED']){
 for(final failRecovery in [false,true]){
  testWidgets('$code withdrawal retires cached pickup with delayed recovery failure=$failRecovery',(tester)async{
   final api=ConflictedWithdrawalApi(code);addTearDown(api.close);final old=api.current;
   await mount(tester,api);final reasons=find.text('Choose reason to request withdrawal');
   await tester.scrollUntilVisible(reasons,400);await tester.ensureVisible(reasons);await tester.pumpAndSettle();await tester.tap(reasons);await tester.pumpAndSettle();
   await tester.tap(find.text('Safety'));await tester.pump();await tester.pump(const Duration(milliseconds:300));
   await tester.drag(find.byType(ListView).first,const Offset(0,2000));await tester.pump();
   expect(find.text('Confirm pickup'),findsNothing);
   api.publish(old);await tester.pump();expect(find.byKey(const ValueKey('food-custody-PICKUP')),findsNothing);
   final a=old.assignment as FoodDriverAssignment;
   api.publish(FoodDriverWork(offers:[],assignment:FoodDriverRestrictedAssignment(access:'RESTRICTED',id:a.id,shipmentId:a.shipmentId,generation:a.generation,leaseGeneration:a.leaseGeneration,shipmentVersion:a.shipmentVersion,custodyPhase:'PREPICKUP',reason:'DRIVER_SUSPENDED')));
   await tester.pump();await tester.drag(find.byType(ListView).first,const Offset(0,2000));await tester.pump();
   expect(find.text('Food not collected'),findsNothing);expect(find.text('Job restricted — duty retained'),findsNothing);
   if(failRecovery){api.read!.completeError(const MobileApiException('NETWORK_UNAVAILABLE',503));}
   else {api.read!.complete(FoodDriverWork(offers:[],assignment:FoodDriverAssignment.fromJson({...a.toJson(),'state':'PICKED_UP','proofs':[]})));}
   await tester.pumpAndSettle();await tester.drag(find.byType(ListView).first,const Offset(0,2000));await tester.pumpAndSettle();
   if(failRecovery){expect(find.text('No current snapshot available'),findsOneWidget);expect(find.text('Food not collected'),findsNothing);}
   else {expect(find.text('Delivering food'),findsOneWidget);}
   expect(find.byKey(const ValueKey('food-custody-PICKUP')),findsNothing);expect(tester.takeException(),isNull);
  });
 }
 }
 for(final transition in ['background','disconnect','assignment','proof','dispose']){
  testWidgets('custody secret cannot outlive private $transition transition',(tester) async {
   final api=LiveWorkApi();addTearDown(api.close);await mount(tester,api);await custody(tester);
   if(transition=='background'){tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);}
   if(transition=='disconnect')api.updates.add(const FoodRealtimeDisconnected(MobileApiException('REALTIME_DISCONNECTED',503)));
   if(transition=='assignment')api.publish(work(assignment:fixture.second,proof:third));
   if(transition=='proof')api.publish(work(proof:third));
   if(transition=='dispose')await tester.pumpWidget(const MaterialApp(home:Scaffold(body:Text('Replacement surface'))));
   await tester.pumpAndSettle();expect(find.byType(AlertDialog),findsNothing);expect(find.text('private-fixture-custody-secret-123456'),findsNothing);expect(find.byWidgetPredicate((widget)=>widget is ModalBarrier&&widget.dismissible),findsNothing);expect(api.submitted,isEmpty);expect(tester.takeException(),isNull);
   if(transition=='dispose')expect(find.text('Replacement surface'),findsOneWidget);
  });
 }
 testWidgets('unchanged current custody confirmation still records pickup',(tester) async {
  final api=LiveWorkApi();addTearDown(api.close);await mount(tester,api);await custody(tester);await tester.tap(find.text('Confirm'));await tester.pumpAndSettle();
  expect(find.byType(AlertDialog),findsNothing);expect(api.submitted.length,1);final collected=find.text('Food collected — travel to customer');await tester.scrollUntilVisible(collected,-300);expect(collected,findsOneWidget);
 });
 for(final revoked in [false,true]){
  testWidgets('finite ${revoked?'current revocation clears':'superseded failure preserves'} current GPS ownership',(tester) async {
   final api=LiveWorkApi();addTearDown(api.close);await mount(tester,api);
   final gps=find.text('Allow and start assignment GPS');await tester.scrollUntilVisible(gps,300);await tester.ensureVisible(gps);await tester.pumpAndSettle();await tester.tap(gps);await tester.pumpAndSettle();expect(find.text('Stop sharing location'),findsOneWidget);
   final held=Completer<FoodDriverWork>();api.read=held;
   final refresh=find.byTooltip('Refresh');await tester.scrollUntilVisible(refresh,-300);await tester.ensureVisible(refresh);await tester.pumpAndSettle();await tester.tap(refresh);await tester.pump();
   api.publish(work(name:'Current live recipient'));await tester.pump();await tester.pump();
   if(revoked)api.authenticated=false;
   held.completeError(MobileApiException(revoked?'AUTH_REQUIRED':'SESSION_CHANGED',revoked?401:409));await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:20)));await tester.pumpAndSettle();
   if(revoked){expect(find.text('No current snapshot available'),findsOneWidget);expect(find.text('Stop sharing location'),findsNothing);}
   else{await tester.scrollUntilVisible(find.text('Current live recipient'),300);expect(find.text('Current live recipient'),findsOneWidget);await tester.scrollUntilVisible(find.text('Stop sharing location'),300);expect(find.text('Stop sharing location'),findsOneWidget);}
  });
 }
 testWidgets('restricted retained duty removes private work and custody modal and stops native capture',(tester)async{
  tester.view.physicalSize=const Size(800,2800);tester.view.devicePixelRatio=1;addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
  final api=LiveWorkApi()..current=work(name:'Private authority fixture recipient');addTearDown(api.close);await mount(tester,api);expect(find.text('Private authority fixture recipient'),findsOneWidget);
  final gps=find.text('Allow and start assignment GPS');await tester.scrollUntilVisible(gps,300);await tester.ensureVisible(gps);await tester.pumpAndSettle();await tester.tap(gps);await tester.pumpAndSettle();expect(native.positions.hasListener,true);
  await custody(tester);
  api.publish(FoodDriverWork(offers:[],assignment:FoodDriverRestrictedAssignment(access:'RESTRICTED',id:fixture.first,shipmentId:fixture.first,generation:'1',leaseGeneration:'1',shipmentVersion:'4',custodyPhase:'PREPICKUP',reason:'DRIVER_SUSPENDED')));
  await tester.pumpAndSettle();
  expect(find.byType(AlertDialog),findsNothing);expect(find.text('private-fixture-custody-secret-123456'),findsNothing);expect(find.text('Stop sharing location'),findsNothing);
  expect(native.positions.hasListener,false);expect(native.services.hasListener,false);expect(api.submitted,isEmpty);
  expect(find.text('Private authority fixture recipient'),findsNothing);expect(find.text('Fixture'),findsNothing);expect(find.byKey(const ValueKey('food-custody-PICKUP')),findsNothing);expect(tester.takeException(),isNull);
 });
}
