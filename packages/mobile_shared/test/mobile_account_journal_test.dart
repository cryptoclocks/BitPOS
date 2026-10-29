import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/account_mutation.dart';
import 'mobile_session_race_test.dart' as fixture;

void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 void initialize()=>FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode(fixture.session('1'))});
 final profile=MobileProfile(id:fixture.session('1')['accountId'] as String,displayName:'Original',locale:'th',version:'1');
 final response=MobileProfile(id:profile.id,displayName:'Updated fixture',locale:'en',version:'2');
 test('ambiguous profile change survives restart and blocks a replacement command',() async {
  initialize();var committed=false;final keys=<String>[];
  MobileApi makeApi()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request) async {
   keys.add((jsonDecode(request.body) as Map)['idempotencyKey'] as String);
   if(!committed){committed=true;throw http.ClientException('fixture response lost after commit');}
   return http.Response(jsonEncode(response.toJson()),200);
  }));
  final first=makeApi();await first.restore();
  final command=first.profileMutation(profile,response.displayName,response.locale);
  await expectLater(first.submitAccountMutation(command),throwsA(isA<http.ClientException>()));first.close();
  final restarted=makeApi();addTearDown(restarted.close);await restarted.restore();
  final recovered=await restarted.pendingAccountMutation();expect(recovered,isA<ProfileMutation>());
  expect(recovered!.toJson(),command.toJson());
  await expectLater(restarted.submitAccountMutation(restarted.profileMutation(profile,'Different change','th')),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','PENDING_ACCOUNT_RECOVERY_REQUIRED')));
  await restarted.submitAccountMutation(recovered);
  expect(await restarted.pendingAccountMutation(),isNull);
  expect(keys,[command.command.idempotencyKey,command.command.idempotencyKey]);
 });
 test('malformed or wrong-owner success cannot discard the only recovery command',() async {
  initialize();var mode=0;
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request) async {
   if(mode==0)return http.Response('{}',200);
   return http.Response(jsonEncode({...response.toJson(),'id':mode==1?fixture.session('2')['accountId']:profile.id}),200);
  }));addTearDown(api.close);await api.restore();
  final command=api.profileMutation(profile,response.displayName,response.locale);
  for(mode=0;mode<2;mode++){
   await expectLater(api.submitAccountMutation(command),throwsFormatException);
   expect((await api.pendingAccountMutation())!.toJson(),command.toJson());
  }
  await api.submitAccountMutation(command);expect(await api.pendingAccountMutation(),isNull);
 });
}
