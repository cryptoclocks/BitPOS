import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/food_cancellation_review_mutation.dart';
import 'mobile_session_race_test.dart' as fixture;
String id(int n)=>'00000000-0000-4000-8000-${n.toString().padLeft(12,'0')}';
FoodCancellationReviewMutation command(int key)=>FoodCancellationReviewMutation(orderId:id(1),shipmentId:id(2),command:FoodCancellationReviewRequestCommand(idempotencyKey:id(key),expectedVersion:'7',reasonCode:'LATE_ORDER',detail:'Synthetic private support detail'));
Map<String,dynamic> receipt()=>{'review':{'state':'OPEN','reviewId':id(3),'shipmentId':id(2),'reviewVersion':'1','reasonCode':'LATE_ORDER','requestedShipmentVersion':'7','requestedShipmentState':'AT_PICKUP','requestedAt':'2026-10-18T01:00:00Z'},'shipmentVersion':'8','orderCancelled':false,'refundExecuted':false,'custodyReleased':false,'stockReturned':false};
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 setUp(()=>FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(fixture.session('1'))}));
 test('lost review receipt survives restart and prevents a different customer review request',()async{
  var lost=true,requests=0;
  MobileApi make()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{requests++;if(lost){lost=false;throw http.ClientException('Synthetic response lost');}return http.Response(jsonEncode(receipt()),200);}));
  final first=make();await first.restore();await expectLater(first.submitCancellationReview(command(4)),throwsA(isA<http.ClientException>()));first.close();
  final restarted=make();addTearDown(restarted.close);await restarted.restore();final pending=await restarted.pendingCancellationReview();expect(pending,isNotNull);
  await expectLater(restarted.submitCancellationReview(command(5)),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','PENDING_CANCELLATION_REVIEW_RECOVERY_REQUIRED')));expect(requests,1);
  final result=await restarted.submitCancellationReview(pending!);expect(result.review,isA<FoodCancellationReviewOpen>());expect(await restarted.pendingCancellationReview(),isNull);expect(requests,2);
 });
 for(final field in ['shipmentId','reasonCode','requestedShipmentVersion','refundExecuted']){
  test('mismatched or fabricated $field cannot erase an unresolved review request',()async{
   var wrong=true;final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async{final value=receipt();if(wrong){if(field=='refundExecuted'){value[field]=true;}else{(value['review'] as Map<String,dynamic>)[field]=field=='shipmentId'?id(99):field=='reasonCode'?'OTHER':'99';}}return http.Response(jsonEncode(value),200);}));addTearDown(api.close);await api.restore();
   await expectLater(api.submitCancellationReview(command(4)),throwsA(isA<FormatException>()));expect((await api.pendingCancellationReview())?.command.idempotencyKey,id(4));
   wrong=false;await api.submitCancellationReview(command(4));expect(await api.pendingCancellationReview(),isNull);
  });
 }
 test('definitive already-open review rejects the new request and retires its obsolete journal',()async{
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request)async=>http.Response(jsonEncode({'error':{'code':'CANCELLATION_REVIEW_OPEN','message':'Open review exists','retryable':false}}),409)));addTearDown(api.close);await api.restore();
  await expectLater(api.submitCancellationReview(command(4)),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','CANCELLATION_REVIEW_OPEN')));expect(await api.pendingCancellationReview(),isNull);
 });
}
