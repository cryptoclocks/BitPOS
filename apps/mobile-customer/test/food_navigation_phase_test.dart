import 'dart:async';
import 'package:flutter/material.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'food_delivery_test.dart' as fixture;
FoodCustomerWork phase(String state)=>FoodCustomerWork.fromJson({...fixture.work(2).toJson(),'assignment':{...fixture.work(2).assignment!.toJson(),'state':state}});
FoodNavigationSnapshot navigation(String state,int metres)=>FoodNavigationSnapshot.fromJson({'serverTime':DateTime.now().toUtc().toIso8601String(),'assignment':{'assignmentId':fixture.id(2),'generation':'1','leaseGeneration':'1','shipmentId':fixture.id(1),'state':state,'fixture':true,'target':state=='PICKED_UP'?'DROPOFF':'PICKUP','targetLatitudeE7':0,'targetLongitudeE7':10000,'location':{'sequence':'1','latitudeE7':0,'longitudeE7':0,'accuracyMm':5000,'capturedAt':DateTime.now().toUtc().toIso8601String(),'receivedAt':DateTime.now().toUtc().toIso8601String(),'stale':false}},'route':{'points':[{'latitudeE7':0,'longitudeE7':0},{'latitudeE7':0,'longitudeE7':10000}],'durationSeconds':120,'distanceMetres':metres,'fixture':true,'attribution':'Synthetic phase fixture'},'routeUnavailable':null,'tilesAvailable':false,'tileAttribution':null,'tileFixture':false});
class PhaseApi extends fixture.DeliveryApi{
 final held=<String,Completer<FoodNavigationSnapshot>>{};
 @override Future<FoodNavigationSnapshot> foodNavigation({String? orderId,required String assignmentId,required String generation,required String leaseGeneration}){final state=current.assignment!.state;return held[state]?.future??Future.value(navigation(state,state=='PICKED_UP'?200:500));}
}
void main(){
 testWidgets('collected food immediately drops former pickup ETA while awaiting dropoff navigation',(tester) async{
  final api=PhaseApi()..current=phase('AT_PICKUP');addTearDown(api.close);await fixture.mount(tester,api);expect(find.textContaining('0.5 km'),findsOneWidget);
  final dropoff=Completer<FoodNavigationSnapshot>();api.held['PICKED_UP']=dropoff;api.current=phase('PICKED_UP');await tester.pump();await tester.pump();expect(find.textContaining('0.5 km'),findsNothing);
  dropoff.complete(navigation('PICKED_UP',200));await tester.pumpAndSettle();expect(find.textContaining('0.2 km'),findsOneWidget);
 });
 testWidgets('late former-phase navigation cannot replace current dropoff route',(tester) async{
  final pickup=Completer<FoodNavigationSnapshot>(),api=PhaseApi()..current=phase('AT_PICKUP');api.held['AT_PICKUP']=pickup;addTearDown(api.close);await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodDeliveryPanel(api:api,orderId:fixture.id(1),thai:false,onAuthenticationRequired:(){})))));await tester.pump();await tester.pump();
  api.current=phase('PICKED_UP');await tester.pumpAndSettle();expect(find.textContaining('0.2 km'),findsOneWidget);
  pickup.complete(navigation('AT_PICKUP',900));await tester.pumpAndSettle();expect(find.textContaining('0.9 km'),findsNothing);expect(find.textContaining('0.2 km'),findsOneWidget);
 });
}
