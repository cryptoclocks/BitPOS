import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_driver/food_idle_location_controller.dart';
import 'package:bitpos_driver/food_idle_discovery_panel.dart';
void main(){
 IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('approved private consent uploads injected native GPS then opt-out erases point',(tester)async{
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit local fixture required');
  final auth=MobileApi(base:Uri.parse('http://10.0.2.2:3008/api/mobile/v1/'),fixture:true);await tester.runAsync(()async{await auth.restore();if(auth.signedIn)await auth.logout();await auth.verifyOtp('+66900000711','123456');});
  final api=MobileApi(base:Uri.parse('http://10.0.2.2:3008/api/mobile/v1/'),fixture:true);await tester.runAsync(api.restore);final location=FoodIdleLocationController(api);addTearDown((){location.dispose();auth.close();api.close();});
  debugPrint('BITPOS_IDLE071_NATIVE ${Platform.operatingSystem} $defaultTargetPlatform');
  location.addListener(()=>debugPrint('BITPOS_IDLE071_CAPTURE sharing=${location.sharing} error=${location.error} received=${location.lastReceivedAt!=null}'));
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SafeArea(child:SingleChildScrollView(child:FoodIdleDiscoveryPanel(api:api,thai:false,location:location,canCapture:true))))));
  Future<void> waitFor(bool Function() condition,String label)async{final until=DateTime.now().add(const Duration(seconds:45));while(!condition()&&DateTime.now().isBefore(until)&&location.error==null){await tester.pump(const Duration(milliseconds:200));}expect(condition(),true,reason:'$label; native error=${location.error}');}
  await tester.pump();await waitFor(()=>find.byType(LinearProgressIndicator).evaluate().isEmpty,'initial authority snapshot');expect(find.byType(CheckboxListTile),findsOneWidget);if(tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value!=true)await tester.tap(find.byType(CheckboxListTile));await tester.pump();
  final start=find.widgetWithText(FilledButton,'Consent and start private GPS');await tester.ensureVisible(start);await tester.tap(start);await tester.pump();
  await waitFor(()=>location.sharing,'actual native GPS starts only after committed explicit consent');debugPrint('BITPOS_IDLE071_GPS_READY');
  await waitFor(()=>location.lastReceivedAt!=null,'injected Android native point acknowledged by actual API');expect(find.text('Capturing private matching location'),findsOneWidget);
  await tester.runAsync(()async{final current=await api.foodDiscovery();expect(current.consent!.enabled,true);expect(current.consent!.ownedBySession,true);expect(current.consent!.location,isNotNull);});
  debugPrint('BITPOS_IDLE071_GPS_COMMITTED');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:2)));
  final stop=find.widgetWithText(OutlinedButton,'Stop and revoke consent');await tester.ensureVisible(stop);await tester.tap(stop);await tester.pump();await waitFor(()=>find.byType(LinearProgressIndicator).evaluate().isEmpty,'revoke commit');expect(location.sharing,false);
  await tester.runAsync(()async{final current=await api.foodDiscovery();expect(current.consent!.enabled,false);expect(current.consent!.location,null);await api.logout();});await tester.pumpWidget(const MaterialApp());
 },timeout:const Timeout(Duration(seconds:120)));
}
