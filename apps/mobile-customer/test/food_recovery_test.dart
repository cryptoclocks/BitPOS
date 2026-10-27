import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/food_page.dart';

class RecoveryApi extends MobileApi {
  RecoveryApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
  int discoveryCalls=0;
  bool failFirstDiscovery=false;
  @override bool get signedIn=>false;
  @override Future<MobileFoodOrderRequest?> pendingFoodOrder() async=>null;
  @override Future<String?> activeFoodOrderId() async=>null;
  @override Future<MobileBranches> branches({String? cursor,String search='',String serving='all'}) async {
    discoveryCalls++;
    if(failFirstDiscovery&&discoveryCalls==1)throw Exception('offline fixture');
    return MobileBranches(branches:[],nextCursor:null);
  }
  @override Future<MobileFoodOrders> foodOrders({String? cursor}) async=>throw const MobileApiException('AUTH_REQUIRED',401);
}
void main(){
 testWidgets('definitively revoked authentication returns ownership to sign-in shell',(tester) async {
  final api=RecoveryApi();addTearDown(api.close);
  bool login=false;
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:StatefulBuilder(builder:(context,setState)=>login?const Text('Sign in again'):FoodPage(api:api,thai:false,onAuthenticationRequired:()=>setState(()=>login=true)))))));
  await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('My orders'));await tester.pumpAndSettle();
  expect(find.text('Sign in again'),findsOneWidget);
  expect(find.byType(FoodPage),findsNothing);
 });
}
