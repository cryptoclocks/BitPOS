import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'mobile_session_race_test.dart' as fixture;
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 void initialize()=>FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode(fixture.session('1'))});
 final command=FoodDiscoveryConsentCommand(idempotencyKey:'00000000-0000-4000-8000-000000000070',expectedVersion:'3',enabled:false,zones:[]);
 test('lost consent response survives restart and only exact retry clears pending operation',()async{
  initialize();var committed=false;final bodies=<String>[];
  MobileApi make()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{bodies.add(request.body);if(!committed){committed=true;throw http.ClientException('fixture committed response lost');}return http.Response(jsonEncode({'revision':'4','enabled':false}),200);}));
  final first=make();await first.restore();await expectLater(first.foodDiscoveryConsent(command),throwsA(isA<http.ClientException>()));first.close();
  final restarted=make();addTearDown(restarted.close);await restarted.restore();final saved=await restarted.pendingFoodDiscoveryConsent();expect(saved!.toJson(),command.toJson());
  await expectLater(restarted.foodDiscoveryConsent(FoodDiscoveryConsentCommand(idempotencyKey:'00000000-0000-4000-8000-000000000071',expectedVersion:'4',enabled:false,zones:[])),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','PENDING_DRIVER_RECOVERY_REQUIRED')));
  final receipt=await restarted.foodDiscoveryConsent(saved);expect(receipt.revision,'4');expect(await restarted.pendingFoodDiscoveryConsent(),isNull);expect(bodies,[jsonEncode(command.toJson()),jsonEncode(command.toJson())]);
 });
 test('new session cannot inherit an unresolved consent command',()async{
  initialize();final first=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((_)async=>throw http.ClientException('fixture network loss')));await first.restore();await expectLater(first.foodDiscoveryConsent(command),throwsA(isA<http.ClientException>()));first.close();
  const storage=FlutterSecureStorage();final replacement={...fixture.session('1'),'sessionId':fixture.session('2')['sessionId']};await storage.write(key:'bitpos.mobileSession',value:jsonEncode(replacement));
  final replacementApi=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);addTearDown(replacementApi.close);await replacementApi.restore();expect(await replacementApi.pendingFoodDiscoveryConsent(),isNull);
 });
 test('definitive conflict clears pending but invalid success retains exact recovery',()async{
  initialize();var conflict=true;final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((_)async=>conflict?http.Response(jsonEncode({'error':{'code':'VERSION_CONFLICT','retryable':false,'message':'VERSION_CONFLICT'}}),409):http.Response('{}',200)));addTearDown(api.close);await api.restore();
  await expectLater(api.foodDiscoveryConsent(command),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','VERSION_CONFLICT')));expect(await api.pendingFoodDiscoveryConsent(),isNull);
  conflict=false;await expectLater(api.foodDiscoveryConsent(command),throwsFormatException);expect((await api.pendingFoodDiscoveryConsent())!.toJson(),command.toJson());
 });
}
