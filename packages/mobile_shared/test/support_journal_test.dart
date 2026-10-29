import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/support_mutation.dart';
import 'mobile_session_race_test.dart' as fixture;
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 void initialize()=>FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode(fixture.session('1'))});
 final response={'id':'00000000-0000-4000-8000-000000000041','subject':'Help','state':'OPEN','createdAt':'2026-10-19T00:00:00.000Z','order':null};
 test('lost support response survives restart, blocks replacement and reuses command ID',()async{
  initialize();var committed=false;final keys=<String>[];
  MobileApi makeApi()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{
   keys.add((jsonDecode(request.body) as Map)['commandId'] as String);
   if(!committed){committed=true;throw http.ClientException('response lost after commit');}
   return http.Response(jsonEncode(response),200);
  }));
  final first=makeApi();await first.restore();final command=first.newSupportCase('Help','Question');
  await expectLater(first.submitSupportMutation(command),throwsA(isA<http.ClientException>()));first.close();
  final second=makeApi();addTearDown(second.close);await second.restore();final recovered=await second.pendingSupportMutation();expect(recovered,isA<CreateSupportMutation>());expect(recovered!.toJson(),command.toJson());
  await expectLater(second.submitSupportMutation(second.newSupportCase('Other','Other')),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','PENDING_SUPPORT_RECOVERY_REQUIRED')));
  await second.submitSupportMutation(recovered);expect(await second.pendingSupportMutation(),isNull);expect(keys,[command.command.commandId,command.command.commandId]);
 });
 test('malformed success keeps recoverable support command',()async{
  initialize();final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((_)async=>http.Response('{}',200)));addTearDown(api.close);await api.restore();
  final command=api.newSupportCase('Help','Question');await expectLater(api.submitSupportMutation(command),throwsFormatException);expect((await api.pendingSupportMutation())!.toJson(),command.toJson());
 });
}
