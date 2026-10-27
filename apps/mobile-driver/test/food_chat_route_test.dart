import 'package:mobile_shared/mobile_api.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:mobile_shared/food_chat_page.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'food_realtime_lifecycle_test.dart' as fixture;
class ChatWorkApi extends fixture.LiveWorkApi {
 @override Future<FoodChatReadReceipt> markFoodChatRead(String assignmentId,String lastReadSequence)async=>FoodChatReadReceipt(assignmentId:assignmentId,lastReadSequence:lastReadSequence,updatedAt:'2026-10-20T01:00:00Z');
 @override Stream<FoodRealtimeState<FoodChatRealtimeSnapshot>> watchFoodChat(String assignmentId)=>const Stream.empty();
 @override Future<FoodChatSendCommand?> pendingFoodChatMessage(String assignmentId)async=>null;
 @override Future<FoodChatPage> foodChat(String assignmentId,{String afterSequence='0',String? beforeSequence})async=>FoodChatPage(assignmentId:assignmentId,myRole:'DRIVER',items:[FoodChatMessage(attachments: const [],id:fixture.third,assignmentId:assignmentId,commandId:fixture.third,sequence:'1',senderRole:'CUSTOMER',mine:false,body:'Private delivery instruction',createdAt:'2026-10-20T01:00:00Z')],nextAfterSequence:null,nextBeforeSequence:null,latestSequence:'1');
}
Future<void> openChat(WidgetTester tester) async {
 final button=find.ancestor(of:find.text('Chat with customer'),matching:find.byType(OutlinedButton));
 for(var attempt=0;button.hitTestable().evaluate().isEmpty&&attempt<30;attempt++){
  await tester.dragFrom(const Offset(12,300),const Offset(0,-200));await tester.pumpAndSettle();
 }
 await tester.tap(button.hitTestable());await tester.pumpAndSettle();
}
void main(){
 testWidgets('rider chat bottom navigation forwards History and lets the parent replace the private chat route',(tester)async{
  final previous=GeolocatorPlatform.instance,native=fixture.ActiveNative();GeolocatorPlatform.instance=native;
  addTearDown((){native.close();GeolocatorPlatform.instance=previous;});
  final api=ChatWorkApi();addTearDown(api.close);var selected=-1;
  await fixture.mount(tester,api,onChatNavigation:(context,index){selected=index;Navigator.of(context).pop();});
  await openChat(tester);
  expect(find.byType(FoodChatPageView),findsOneWidget);expect(find.text('History'),findsOneWidget);
  await tester.tap(find.text('History'));await tester.pumpAndSettle();
  expect(selected,1);expect(find.byType(FoodChatPageView),findsNothing);expect(tester.takeException(),isNull);
 });
 testWidgets('new assigned duty closes old rider chat route and plaintext',(tester)async{
  final previous=GeolocatorPlatform.instance,native=fixture.ActiveNative();GeolocatorPlatform.instance=native;
  addTearDown((){native.close();GeolocatorPlatform.instance=previous;});
  final api=ChatWorkApi();addTearDown(api.close);await fixture.mount(tester,api);
  await openChat(tester);
  expect(find.byType(FoodChatPageView),findsOneWidget);expect(find.text('Private delivery instruction'),findsOneWidget);
  api.publish(fixture.work(assignment:fixture.third));await tester.pumpAndSettle();
  expect(find.byType(FoodChatPageView),findsNothing);expect(find.text('Private delivery instruction'),findsNothing);
  expect(api.submitted,isEmpty);expect(tester.takeException(),isNull);
 });
}
