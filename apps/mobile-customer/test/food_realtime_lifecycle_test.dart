import 'dart:async';
import 'package:bitpos_customer/food_delivery_panel.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'food_delivery_test.dart' as fixture;
class DeferredApi extends fixture.DeliveryApi {
 Completer<FoodCustomerWork>? read;
 Completer<Object>? command;
 @override Future<FoodCustomerWork> foodCustomerWork(String orderId)=>read?.future??super.foodCustomerWork(orderId);
 @override Future<Object> submitFoodDispatch(FoodDispatchMutation value)=>command?.future??super.submitFoodDispatch(value);
}
class SecretApi extends fixture.DeliveryApi {
 @override Future<Object> submitFoodDispatch(FoodDispatchMutation command) async {
  final result=await super.submitFoodDispatch(command) as FoodProofIssueReceipt;
  final a=current.assignment!;
  current=FoodCustomerWork.fromJson({...current.toJson(),'assignment':{...a.toJson(),'deliveryProof':{'id':result.proofId,'kind':'DELIVERY','expiresAt':result.expiresAt,'attemptsRemaining':10}}});
  return result;
 }
}
void main(){
 testWidgets('background completion releases finite-read busy ownership before resume',(tester) async {
  final held=Completer<FoodCustomerWork>(),api=DeferredApi()..read=held;addTearDown(api.close);await fixture.mount(tester,api);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);held.complete(fixture.work(2));await tester.pumpAndSettle();
  expect(find.text('Shipment: Driver at drop-off'),findsNothing);
  api.read=null;tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);await tester.pumpAndSettle();
  final refresh=find.widgetWithText(FilledButton,'Refresh delivery snapshot');expect(tester.widget<FilledButton>(refresh).onPressed,isNotNull);
  expect(find.text('Shipment: Driver at drop-off'),findsOneWidget);
 });
 testWidgets('background proof completion cannot strand controls or publish its secret',(tester) async {
  final held=Completer<Object>(),api=DeferredApi()..command=held;addTearDown(api.close);await fixture.mount(tester,api);
  final issue=find.text('Issue delivery proof');await tester.ensureVisible(issue);await tester.tap(issue);await tester.pump();
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
  held.complete(FoodProofIssueReceipt(proofId:fixture.id(200),assignmentId:fixture.id(2),kind:'DELIVERY',expiresAt:DateTime.now().add(const Duration(minutes:5)).toUtc().toIso8601String(),generation:'1',leaseGeneration:'1',replayed:false,secretRecoveryRequired:false,secret:'hidden-background-fixture-secret'));
  await tester.pumpAndSettle();expect(find.text('hidden-background-fixture-secret'),findsNothing);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);await tester.pumpAndSettle();
  expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton,'Issue delivery proof')).onPressed,isNotNull);
 });
 testWidgets('late superseded finite-read failure cannot erase newer live work',(tester) async {
  final held=Completer<FoodCustomerWork>(),api=DeferredApi()..read=held;addTearDown(api.close);var authentication=0;await fixture.mount(tester,api,auth:()=>authentication++);
  api.current=FoodCustomerWork.fromJson({...fixture.work(3).toJson(),'state':'PICKED_UP'});await tester.pumpAndSettle();expect(find.text('Shipment: Food picked up'),findsOneWidget);
  held.completeError(const MobileApiException('SESSION_CHANGED',409));await tester.pumpAndSettle();
  expect(find.text('Shipment: Food picked up'),findsOneWidget);expect(find.text('No current confirmed snapshot'),findsNothing);expect(authentication,0);
 });
 testWidgets('disconnect clears active proof secret and its open replacement modal',(tester) async {
  final api=SecretApi();addTearDown(api.close);await fixture.mount(tester,api);
  final issue=find.text('Issue delivery proof');await tester.ensureVisible(issue);await tester.tap(issue);await tester.pumpAndSettle();
  expect(find.text(DeliveryCodeCard.grouped('fixture-original-assignment-secret')),findsOneWidget);
  final replace=find.text('Replace delivery proof');await tester.ensureVisible(replace);await tester.tap(replace);await tester.pumpAndSettle();expect(find.byType(AlertDialog),findsOneWidget);
  api.updates.add(const FoodRealtimeDisconnected(MobileApiException('REALTIME_DISCONNECTED',503)));await tester.pumpAndSettle();
  expect(find.byType(AlertDialog),findsNothing);expect(find.text(DeliveryCodeCard.grouped('fixture-original-assignment-secret')),findsNothing);expect(find.text('No current confirmed snapshot'),findsOneWidget);
 });
}
