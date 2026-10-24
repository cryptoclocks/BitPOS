import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'mobile_session_race_test.dart' as fixture;
const assignment='00000000-0000-4000-8000-000000000091';
FoodIncidentMutation report()=>FoodIncidentMutation(assignment,FoodIncidentReportCommand(idempotencyKey:'00000000-0000-4000-8000-000000000092',generation:'2',leaseGeneration:'3',kind:'SOS',body:'Private synthetic safety report, not emergency contact'));
Map<String,dynamic> receipt()=>{'incident':{'incidentId':'00000000-0000-4000-8000-000000000093','assignmentId':assignment,'shipmentId':'00000000-0000-4000-8000-000000000094','generation':'2','leaseGeneration':'3','incidentVersion':'1','kind':'SOS','custodyPhase':'AT_PICKUP','blocksDuty':true,'reportedAt':'2026-10-18T01:00:00Z','acknowledgedAt':null,'resolvedAt':null,'resolution':null},'shipmentVersion':'5','paused':true};
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 setUp(()=>FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(fixture.session('1'))}));
 test('lost incident response survives restart and blocks conflicting pickup until exact recovery',()async{
  var lost=true,pickups=0;
  MobileApi make()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{
   if(request.url.path.endsWith('/consume-proof')){pickups++;return http.Response('{}',500);}
   if(lost){lost=false;throw http.ClientException('Synthetic report response lost');}
   return http.Response(jsonEncode(receipt()),200);
  }));
  final initial=make();await initial.restore();await expectLater(initial.submitFoodDispatch(report()),throwsA(isA<http.ClientException>()));initial.close();
  final resumed=make();addTearDown(resumed.close);await resumed.restore();final pending=await resumed.pendingFoodDispatch();expect(pending,isA<FoodIncidentMutation>());
  final pickup=FoodConsumeMutation(assignment,FoodProofConsumeCommand(idempotencyKey:'00000000-0000-4000-8000-000000000095',proofId:'00000000-0000-4000-8000-000000000096',generation:'2',leaseGeneration:'3',secret:'fixture-only-not-a-real-proof-secret'));
  await expectLater(resumed.submitFoodDispatch(pickup),throwsA(isA<MobileApiException>().having((error)=>error.code,'code','PENDING_DISPATCH_RECOVERY_REQUIRED')));expect(pickups,0);
  expect((await resumed.submitFoodDispatch(pending!)),isA<FoodIncidentReceipt>().having((value)=>value.paused,'paused',true));expect(await resumed.pendingFoodDispatch(),isNull);
 });
 for(final field in ['assignmentId','generation','leaseGeneration','kind']){
  test('wrong incident $field cannot retire pending private report',()async{
   var wrong=true;final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{
    final value=receipt();if(wrong)(value['incident'] as Map<String,dynamic>)[field]=field=='assignmentId'?'00000000-0000-4000-8000-000000000099':field=='kind'?'SUPPORT':'9';return http.Response(jsonEncode(value),200);
   }));addTearDown(api.close);await api.restore();
   await expectLater(api.submitFoodDispatch(report()),throwsA(isA<FormatException>()));expect((await api.pendingFoodDispatch())!.toJson(),report().toJson());
   wrong=false;expect(await api.submitFoodDispatch(report()),isA<FoodIncidentReceipt>());expect(await api.pendingFoodDispatch(),isNull);
  });
 }
 test('definitive incident pause denial retires an obsolete ordinary command',()async{
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async=>http.Response(jsonEncode({'error':{'code':'INCIDENT','message':'Paused','retryable':false}}),409)));addTearDown(api.close);await api.restore();
  final arrive=FoodArrivalMutation(assignment,FoodArrivalCommand(idempotencyKey:'00000000-0000-4000-8000-000000000097',generation:'2',leaseGeneration:'3',stage:'PICKUP'));
  await expectLater(api.submitFoodDispatch(arrive),throwsA(isA<MobileApiException>().having((error)=>error.code,'code','INCIDENT')));expect(await api.pendingFoodDispatch(),isNull);
 });
}
