import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/food_idle_discovery_panel.dart';
import 'package:bitpos_driver/food_idle_location_controller.dart';
import 'food_idle_location_test.dart' as fixture;

class PanelApi extends fixture.IdleApi{
 @override Future<FoodDiscoveryConsentCommand?> pendingFoodDiscoveryConsent()async=>null;
}
void main(){
 testWidgets('inactive consent panels detach before shared controller stop during unmount',(tester)async{
  final api=PanelApi(),location=FoodIdleLocationController(PanelApi());addTearDown(api.close);addTearDown(location.dispose);addTearDown(location.api.close);
  Widget panel(String id)=>Expanded(child:SingleChildScrollView(child:FoodIdleDiscoveryPanel(key:ValueKey(id),api:api,thai:false,location:location,canCapture:true)));
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:Column(children:[panel('old-surface'),panel('replacement-surface')]))));await tester.pumpAndSettle();
  await tester.pumpWidget(const MaterialApp(home:Scaffold(body:Text('Job surface replaced'))));await tester.pumpAndSettle();
  expect(tester.takeException(),isNull);expect(find.text('Job surface replaced'),findsOneWidget);
 });
}
