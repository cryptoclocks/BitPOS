import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_driver/food_idle_location_controller.dart';
import 'package:bitpos_driver/food_idle_discovery_panel.dart';
void main(){
 final binding=IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('private idle consent native surface uses actual committed local authority',(tester)async{
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit local fixture required');
  final auth=MobileApi(base:Uri.parse('http://10.0.2.2:3007/api/mobile/v1/'),fixture:true);await tester.runAsync(()async{await auth.restore();if(auth.signedIn)await auth.logout();await auth.verifyOtp('+66900000002','123456');});expect(tester.takeException(),isNull);expect(auth.signedIn,true);
  final api=MobileApi(base:Uri.parse('http://10.0.2.2:3008/api/mobile/v1/'),fixture:true);await tester.runAsync(api.restore);final location=FoodIdleLocationController(api);addTearDown((){location.dispose();auth.close();api.close();});
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodIdleDiscoveryPanel(api:api,thai:false,location:location,canCapture:true)))));
  Future<void> settled()async{final until=DateTime.now().add(const Duration(seconds:20));while(find.byType(LinearProgressIndicator).evaluate().isNotEmpty&&DateTime.now().isBefore(until)){await tester.pump(const Duration(milliseconds:200));}expect(find.byType(LinearProgressIndicator),findsNothing);}
  await tester.pump();await settled();expect(find.text('Private location for food matching'),findsOneWidget);expect(find.text('No currently approved food service area. Contact operations.'),findsOneWidget);expect(find.text('Not capturing location'),findsOneWidget);
  final stop=find.widgetWithText(OutlinedButton,'Stop and revoke consent');await tester.ensureVisible(stop);await tester.tap(stop);await tester.pump();await settled();expect(find.textContaining('Server consent: false'),findsOneWidget);
  await tester.runAsync(()async{final current=await api.foodDiscovery();expect(current.consent!.enabled,false);expect(current.consent!.ownedBySession,true);expect(current.consent!.location,null);await api.logout();});
  binding.reportData={'status':'PASS_BOUNDED_AVD_PRIVATE_CONSENT','fixture':true,'physicalTesting':'deferred_by_user_2026-10-16','limits':['Actual native surface and API committed revoke only','No approved automatic service on this synthetic driver; no capture or matching implied']};
  debugPrint('BITPOS_IDLE071_RENDERED');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:3)));await tester.pumpWidget(const MaterialApp());
 });
}
