import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_dispatch_mutation.dart';
import 'mobile_session_race_test.dart' as fixture;

void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 test('lost committed refusal survives restart and prevents an ambiguous accept',()async{
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(fixture.session('1'))});
  const offer='00000000-0000-4000-8000-000000000077',shipment='00000000-0000-4000-8000-000000000078';
  final decline=FoodDeclineMutation(offer,FoodDeclineCommand(idempotencyKey:'00000000-0000-4000-8000-000000000079',expectedVersion:'1',generation:'2',reason:'SAFETY'));
  var lost=true,acceptRequests=0;
  MobileApi make()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{
   if(request.url.path.endsWith('/claim')){acceptRequests++;return http.Response('{}',500);}
   if(lost){lost=false;throw http.ClientException('Synthetic response lost after refusal commit');}
   return http.Response(jsonEncode({'offerId':offer,'shipmentId':shipment,'generation':'2','version':'2','state':'REJECTED'}),200);
  }));
  final original=make();await original.restore();await expectLater(original.submitFoodDispatch(decline),throwsA(isA<http.ClientException>()));original.close();
  final restarted=make();addTearDown(restarted.close);await restarted.restore();
  final pending=await restarted.pendingFoodDispatch();expect(pending,isA<FoodDeclineMutation>());expect((pending! as FoodDeclineMutation).command.reason,'SAFETY');
  final accept=FoodClaimMutation(offer,FoodClaimCommand(idempotencyKey:'00000000-0000-4000-8000-000000000080',expectedVersion:'1',generation:'2'));
  await expectLater(restarted.submitFoodDispatch(accept),throwsA(isA<MobileApiException>().having((error)=>error.code,'code','PENDING_DISPATCH_RECOVERY_REQUIRED')));expect(acceptRequests,0);
  final receipt=await restarted.submitFoodDispatch(pending);expect(receipt,isA<FoodDeclineReceipt>().having((value)=>value.state,'state','REJECTED'));expect(await restarted.pendingFoodDispatch(),isNull);
 });
 test('lost withdrawal receipt survives restart and blocks pickup until exact recovery',()async{
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(fixture.session('1'))});
  const assignment='00000000-0000-4000-8000-000000000081',shipment='00000000-0000-4000-8000-000000000082';
  final command=FoodWithdrawMutation(assignment,FoodWithdrawCommand(idempotencyKey:'00000000-0000-4000-8000-000000000083',expectedVersion:'4',generation:'2',leaseGeneration:'3',reason:'SAFETY'));
  var lost=true,pickups=0;final committed=<Map<String,dynamic>>[];
  MobileApi make()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{
   if(request.url.path.endsWith('/consume-proof')){pickups++;return http.Response('{}',500);}
   committed.add(jsonDecode(request.body) as Map<String,dynamic>);
   if(lost){lost=false;throw http.ClientException('Synthetic response lost after withdrawal commit');}
   return http.Response(jsonEncode({'assignmentId':assignment,'shipmentId':shipment,'generation':'2','leaseGeneration':'3','shipmentGeneration':'3','shipmentVersion':'5','state':'RELEASED','searchEpoch':null,'replacementOffer':null}),200);
  }));
  final original=make();await original.restore();await expectLater(original.submitFoodDispatch(command),throwsA(isA<http.ClientException>()));original.close();
  final restarted=make();addTearDown(restarted.close);await restarted.restore();
  final pending=await restarted.pendingFoodDispatch();expect(pending,isA<FoodWithdrawMutation>());
  final pickup=FoodConsumeMutation(assignment,FoodProofConsumeCommand(idempotencyKey:'00000000-0000-4000-8000-000000000084',proofId:'00000000-0000-4000-8000-000000000085',generation:'2',leaseGeneration:'3',secret:'fixture-only-pickup-secret-123456'));
  await expectLater(restarted.submitFoodDispatch(pickup),throwsA(isA<MobileApiException>().having((error)=>error.code,'code','PENDING_DISPATCH_RECOVERY_REQUIRED')));expect(pickups,0);
  expect(await restarted.submitFoodDispatch(pending!),isA<FoodRecoveryReceipt>().having((value)=>value.state,'state','RELEASED'));
  expect(committed,[command.body,command.body]);expect(await restarted.pendingFoodDispatch(),isNull);
 });
 for(final mismatch in ['assignmentId','generation','leaseGeneration','replacementOffer']){
  test('mismatched withdrawal $mismatch retains exact recovery journal',()async{
   FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(fixture.session('1'))});
   const assignment='00000000-0000-4000-8000-000000000081';
   final command=FoodWithdrawMutation(assignment,FoodWithdrawCommand(idempotencyKey:'00000000-0000-4000-8000-000000000083',expectedVersion:'4',generation:'2',leaseGeneration:'3',reason:'SAFETY'));
   var wrong=true;
   final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{
    final receipt=<String,dynamic>{'assignmentId':assignment,'shipmentId':'00000000-0000-4000-8000-000000000082','generation':'2','leaseGeneration':'3','shipmentGeneration':'3','shipmentVersion':'5','state':'RELEASED','searchEpoch':null,'replacementOffer':null};
    if(wrong)receipt[mismatch]=mismatch=='replacementOffer'?{'offerId':'00000000-0000-4000-8000-000000000099','shipmentId':receipt['shipmentId'],'generation':'4','version':'1'}:mismatch=='assignmentId'?'00000000-0000-4000-8000-000000000099':'9';
    return http.Response(jsonEncode(receipt),200);
   }));addTearDown(api.close);await api.restore();
   await expectLater(api.submitFoodDispatch(command),throwsA(isA<FormatException>()));
   expect((await api.pendingFoodDispatch())!.toJson(),command.toJson());
   wrong=false;expect(await api.submitFoodDispatch(command),isA<FoodRecoveryReceipt>());expect(await api.pendingFoodDispatch(),isNull);
  });
 }
}
