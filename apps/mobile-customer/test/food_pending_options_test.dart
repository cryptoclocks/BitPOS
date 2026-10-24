import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/food_page.dart';
import 'food_history_test.dart' show id;
class PendingOptionsApi extends MobileApi{
 PendingOptionsApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 final saved=MobileFoodOrderRequest(branchId:id(1),quoteId:id(2),priceVersion:id(3),idempotencyKey:id(4));
 final attempts=<MobileFoodOrderRequest>[];
 @override bool get signedIn=>true;
 @override Future<MobileFoodOrderRequest?> pendingFoodOrder() async=>saved;
 @override Future<String?> activeFoodOrderId() async=>null;
 @override Future<MobileBranches> branches({String? cursor,String search='',String serving='all'}) async=>MobileBranches(branches:[],nextCursor:null);
 @override MobileFoodOrderRequest newFoodOrderCommand({required String branchId,required String quoteId,required String priceVersion})=>throw StateError('Must not replace saved command');
 @override Future<MobileFoodOrderResult> submitFoodOrder(MobileFoodOrderRequest command) async{attempts.add(command);throw TimeoutException('Fixture outcome unknown, options may have changed');}
}
void main(){
 testWidgets('unknown saved command retries exact original quote and key instead of repricing',(tester) async{
  final api=PendingOptionsApi();addTearDown(api.close);
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodPage(api:api,thai:false,onAuthenticationRequired:(){})))));await tester.pumpAndSettle();
  for(var n=0;n<2;n++){await tester.ensureVisible(find.text('Recover / retry saved request'));await tester.tap(find.text('Recover / retry saved request'));await tester.pumpAndSettle();}
  expect(api.attempts.length,2);for(final command in api.attempts){expect(command.toJson(),api.saved.toJson());}expect(find.text('Saved order request'),findsOneWidget);expect(find.text('Refresh menu; keep cart'),findsNothing);
 });
}
