import 'dart:convert';import 'package:flutter_test/flutter_test.dart';import 'package:flutter_secure_storage/flutter_secure_storage.dart';import 'package:http/http.dart'as http;import 'package:http/testing.dart';import 'package:mobile_shared/mobile_api.dart';import 'mobile_session_race_test.dart'as fixture;
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();const order='00000000-0000-4000-8000-000000000041';
 void initialize()=>FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode(fixture.session('1'))});
 final receipt={'id':'00000000-0000-4000-8000-000000000042','orderId':order,'stars':4,'driverStars':null,'body':'Meal review','state':'PENDING','version':'1','feedback':'','createdAt':'2026-10-19T00:00:00Z','updatedAt':'2026-10-19T00:00:00Z'};
 test('review response loss survives restart and blocks another review until exact replay',()async{
  initialize();var committed=false;final keys=<String>[];
  MobileApi make()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((r)async{keys.add((jsonDecode(r.body)as Map)['commandId']as String);if(!committed){committed=true;throw http.ClientException('response lost after commit');}return http.Response(jsonEncode(receipt),200);}));
  final first=make();await first.restore();final command=first.newFoodReview(order,'0',stars:4,body:'Meal review');await expectLater(first.submitReviewMutation(command),throwsA(isA<http.ClientException>()));first.close();final second=make();addTearDown(second.close);await second.restore();final saved=await second.pendingReviewMutation();expect(saved!.toJson(),command.toJson());
  await expectLater(second.submitReviewMutation(second.newFoodReview(order,'0',stars:1,body:'Replacement')),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','PENDING_REVIEW_RECOVERY_REQUIRED')));await second.submitReviewMutation(saved);expect(await second.pendingReviewMutation(),isNull);expect(keys,[command.command.commandId,command.command.commandId]);
 });
 test('wrong-order receipt and retryable authority conflict retain review journal',()async{
  initialize();var mode=0;final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((_)async=>mode==0?http.Response(jsonEncode({...receipt,'orderId':'00000000-0000-4000-8000-000000000043'}),200):http.Response(jsonEncode({'error':{'code':mode==1?'DISPATCH_AUTH_RETRY':'VERSION_CONFLICT'}}),409)));addTearDown(api.close);await api.restore();final command=api.newFoodReview(order,'0',stars:4,body:'Meal review');
  await expectLater(api.submitReviewMutation(command),throwsFormatException);expect((await api.pendingReviewMutation())!.toJson(),command.toJson());mode=1;await expectLater(api.submitReviewMutation(command),throwsA(isA<MobileApiException>()));expect((await api.pendingReviewMutation())!.toJson(),command.toJson());mode=2;await expectLater(api.submitReviewMutation(command),throwsA(isA<MobileApiException>()));expect(await api.pendingReviewMutation(),isNull);
 });
}
