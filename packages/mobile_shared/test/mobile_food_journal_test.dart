import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'mobile_session_race_test.dart' as fixture;

class DelayedJournalStorage extends FlutterSecureStorage {
 DelayedJournalStorage({this.prefix='bitpos.pendingFood.'});
 final String prefix;
 final entered=Completer<void>(),release=Completer<void>();
 bool delayed=false;
 @override Future<void> write({required String key,required String? value,AppleOptions? iOptions,AndroidOptions? aOptions,LinuxOptions? lOptions,WebOptions? webOptions,AppleOptions? mOptions,WindowsOptions? wOptions}) async {
  if(key.startsWith(prefix)&&!delayed){delayed=true;entered.complete();await release.future;}
  await super.write(key:key,value:value,iOptions:iOptions,aOptions:aOptions,lOptions:lOptions,webOptions:webOptions,mOptions:mOptions,wOptions:wOptions);
 }
}
String id(int n)=>'00000000-0000-4000-8000-${n.toString().padLeft(12,'0')}';
MobileFoodOrder committedOrder(){
 final money=MobileMoney(currency:'USD',decimals:2,amountMinor:'270');
 return MobileFoodOrder(preparation:null,id:id(31),merchantId:id(100),branchId:id(101),status:'AWAITING_WALLET',version:1,acceptanceStatus:'PENDING',acceptanceVersion:0,acceptanceDeadline:'2026-10-16T00:01:00Z',acceptanceReason:null,eventSequence:'1',refunds:[],nextRefundCursor:null,fulfillmentStatus:'RECEIVED',fulfillmentVersion:0,createdAt:'2026-10-16T00:00:00Z',quoteExpiresAt:'2026-10-16T00:01:00Z',total:money,settlement:MobileSettlement(money:MobileMoney(currency:'USDG',decimals:6,amountMinor:'2700000'),recipient:'fixture',network:'solana:devnet',genesisHash:'fixture',mint:'fixture',tokenProgram:'fixture',testToken:true),lines:[MobileFoodLine(productId:id(102),name:'อาหาร',nameEn:'Fixture food',qty:1,unitPrice:money,basePrice:money)],paymentUrl:'https://pay.cashlessthailand.com/pay/${List.filled(43,'a').join()}',configured:null,delivery:null);
}
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 test('remounted journal claimant cannot overtake an invisible durable write',() async {
  FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode(fixture.session('1'))});
  final storage=DelayedJournalStorage();
  final posted=<String>[];
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,storage:storage,client:MockClient((request) async {
   posted.add((jsonDecode(request.body) as Map)['idempotencyKey'] as String);
   throw http.ClientException('response lost fixture');
  }));addTearDown(api.close);await api.restore();
  final c=api.newFoodOrderCommand(branchId:fixture.session('1')['accountId'] as String,quoteId:fixture.session('1')['sessionId'] as String,priceVersion:fixture.session('2')['sessionId'] as String);
  final d=api.newFoodOrderCommand(branchId:c.branchId,quoteId:c.quoteId,priceVersion:c.priceVersion);
  final old=api.submitFoodOrder(c);
  final oldFailure=expectLater(old,throwsA(isA<http.ClientException>()));
  await storage.entered.future;
  // A failed logout can remount a page on this same authenticated API instance.
  final replacement=api.submitFoodOrder(d);
  final replacementFailure=expectLater(replacement,throwsA(isA<MobileApiException>().having((e)=>e.code,'code','PENDING_ORDER_RECOVERY_REQUIRED')));
  var readFinished=false;
  final saved=api.pendingFoodOrder().then((value){readFinished=true;return value;});
  await Future<void>.delayed(Duration.zero);
  expect(posted,isEmpty);expect(readFinished,isFalse);
  storage.release.complete();
  await oldFailure;await replacementFailure;
  expect((await saved)!.toJson(),c.toJson());
  expect(posted,[c.idempotencyKey]);
 });
 for(final relogin in [false,true]){
  test('old completion cannot erase newer ambiguous command same-account relogin=$relogin',() async {
   FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':id(99),'bitpos.mobileSession':jsonEncode(fixture.session('1'))});
   final storage=DelayedJournalStorage(prefix:'bitpos.activeFood.');
   late MobileFoodOrderRequest c,d;
   final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,storage:storage,client:MockClient((request) async {
    if(request.url.path.endsWith('/auth/logout'))return http.Response('{}',200);
    if(request.url.path.endsWith('/auth/verify'))return http.Response(jsonEncode({...fixture.session('2'),'accountId':fixture.session('1')['accountId']}),200);
    final body=jsonDecode(request.body) as Map;
    if(body['idempotencyKey']==d.idempotencyKey)throw http.ClientException('new D response lost');
    return http.Response(jsonEncode(MobileFoodOrderResult(order:committedOrder(),replayed:false).toJson()),200,headers:{'content-type':'application/json; charset=utf-8'});
   }));addTearDown(api.close);await api.restore();
   c=api.newFoodOrderCommand(branchId:id(101),quoteId:id(103),priceVersion:id(104));
   d=api.newFoodOrderCommand(branchId:c.branchId,quoteId:c.quoteId,priceVersion:c.priceVersion);
   final old=api.submitFoodOrder(c);await Future.any([storage.entered.future,old.then((_)=>throw StateError('Order finished without active storage gate'))]);
   if(relogin){await api.logout();await api.verifyOtp('+66900000001','123456');}
   var replayFinished=false;
   final newer=api.submitFoodOrder(c).then((_) async {replayFinished=true;await api.submitFoodOrder(d);});
   final ambiguous=expectLater(newer,throwsA(isA<http.ClientException>()));
   await Future<void>.delayed(Duration.zero);
   expect(replayFinished,isFalse,reason:'Remounted surface cannot overtake old completion');
   storage.release.complete();await old;await ambiguous;
   expect((await api.pendingFoodOrder())!.toJson(),d.toJson());
   expect(await api.activeFoodOrderId(),committedOrder().id);
  });
 }
}
