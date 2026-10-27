import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_driver/food_idle_location_controller.dart';
import 'package:bitpos_driver/food_idle_discovery_panel.dart';
import 'food_idle_location_test.dart' show IdleNative;
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 for(final withdraw in [true,false]){
  testWidgets(withdraw?'withdrawal resolves lost committed enable unchanged without restarting GPS':'intentional recovery of lost enable still starts private GPS',(tester)async{
   FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode({'accountId':'00000000-0000-4000-8000-000000000001','sessionId':'00000000-0000-4000-8000-000000000011','accessToken':List.filled(43,'1').join(),'refreshToken':List.filled(43,'1').join(),'accessExpiresAt':'2099-01-01T00:00:00Z','refreshExpiresAt':'2099-02-01T00:00:00Z'})});
   final previous=GeolocatorPlatform.instance,native=IdleNative();GeolocatorPlatform.instance=native;var enabled=false,lost=false,revision=0;final commands=<Map<String,dynamic>>[],receipts=<String,Map<String,dynamic>>{};
   const merchant='00000000-0000-4000-8000-000000000022',branch='00000000-0000-4000-8000-000000000033',expiry='2099-01-01T00:00:00Z';
   MobileApi make()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{
    if(request.method=='GET')return http.Response(jsonEncode(FoodDiscoverySnapshot(services:[FoodDiscoveryService(merchantId:merchant,branchId:branch,revision:'1',validUntil:expiry,eligible:true,selected:enabled)],consent:revision==0?null:FoodDiscoveryConsentState(revision:'$revision',enabled:enabled,ownedBySession:true,expiresAt:expiry,location:null)).toJson()),200);
    final body=jsonDecode(request.body) as Map<String,dynamic>;commands.add(body);final key=body['idempotencyKey'] as String;
    if(!receipts.containsKey(key)){expect(body['expectedVersion'],'$revision');revision++;enabled=body['enabled'] as bool;receipts[key]={'revision':'$revision','enabled':enabled};}
    if(!lost){lost=true;throw http.ClientException('fixture enabled committed but response lost');}
    return http.Response(jsonEncode(receipts[key]),200);
   }));
   final first=make();await first.restore();final original=FoodDiscoveryConsentCommand(idempotencyKey:'00000000-0000-4000-8000-000000000044',expectedVersion:'0',enabled:true,zones:[FoodDiscoveryZone(merchantId:merchant,branchId:branch)]);await expectLater(first.foodDiscoveryConsent(original),throwsA(isA<http.ClientException>()));first.close();
   final restarted=make();await restarted.restore();final controller=FoodIdleLocationController(restarted);
   addTearDown(()async{await controller.stop();controller.dispose();restarted.close();await native.points.close();await native.services.close();GeolocatorPlatform.instance=previous;});
   Future<void> settled()async{for(var i=0;i<50;i++){await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:5)));await tester.pump(const Duration(milliseconds:20));if(find.byType(LinearProgressIndicator).evaluate().isEmpty)return;}expect(find.byType(LinearProgressIndicator),findsNothing);}
   await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodIdleDiscoveryPanel(api:restarted,thai:false,location:controller,canCapture:true)))));await settled();
   final action=find.widgetWithText(withdraw?OutlinedButton:FilledButton,withdraw?'Stop and revoke consent':'Retry exact unresolved consent');expect(action,findsOneWidget);await tester.ensureVisible(action);await tester.tap(action);await settled();
   expect(commands[1],commands[0]);expect(commands[0],original.toJson());expect(controller.sharing,!withdraw);expect(native.points.hasListener,!withdraw);expect(enabled,!withdraw);expect(await restarted.pendingFoodDiscoveryConsent(),isNull);
   if(withdraw){expect(commands.length,3);expect(commands[2]['enabled'],false);expect(commands[2]['expectedVersion'],'1');expect(commands[2]['idempotencyKey'],isNot(original.idempotencyKey));expect(find.textContaining('Server consent: false'),findsOneWidget);}
   await tester.pumpWidget(const MaterialApp());await tester.runAsync(controller.stop);
  });
 }
}
