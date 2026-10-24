import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_shared/mobile_api.dart';
import 'mobile_session_race_test.dart' as fixture;
import 'mobile_food_journal_test.dart' show committedOrder;
class StreamingClient extends http.BaseClient {
 StreamingClient(this.respond);
 final Stream<List<int>> Function(http.BaseRequest) respond;
 @override Future<http.StreamedResponse> send(http.BaseRequest request) async=>http.StreamedResponse(respond(request),200);
}
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 void initialize()=>FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(fixture.session('1'))});
 test('full owned order accepts a bounded response beyond default cap',() async {
  initialize();final encoded=utf8.encode(jsonEncode(committedOrder().toJson()));
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:StreamingClient((_) async*{yield Uint8List(1100000)..fillRange(0,1100000,32);yield encoded;}));addTearDown(api.close);await api.restore();
  expect((await api.foodOrder(committedOrder().id)).id,committedOrder().id);
 });
 for(final history in [true,false]){
  test('default response cap cancels chunked ${history?'history':'menu'} before reading remainder',() async {
   initialize();var reachedRemainder=false,cancelled=false;
   Stream<List<int>> body() async*{try{yield Uint8List(700000);yield Uint8List(700000);reachedRemainder=true;yield utf8.encode('{}');}finally{cancelled=true;}}
   final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:StreamingClient((_)=>body()));addTearDown(api.close);await api.restore();
   await expectLater(history?api.foodOrders():api.menu(committedOrder().branchId),throwsA(isA<FormatException>().having((e)=>e.message,'message','API response too large')));
   expect(reachedRemainder,false);expect(cancelled,true);
  });
 }
 test('configured response cap cancels unknown-length stream at24MiB',() async {
  initialize();var chunks=0,cancelled=false;
  Stream<List<int>> body() async*{try{for(var n=0;n<30;n++){chunks++;yield Uint8List(1024*1024);}}finally{cancelled=true;}}
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:StreamingClient((_)=>body()));addTearDown(api.close);await api.restore();
  await expectLater(api.foodOrder(committedOrder().id),throwsA(isA<FormatException>().having((e)=>e.message,'message','API response too large')));
  expect(chunks,25);expect(cancelled,true);
 });
 test('trickling body reaches total deadline and cancels its subscription',() async {
  initialize();var cancelled=false;
  final stream=StreamController<List<int>>(onCancel:(){cancelled=true;});
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:StreamingClient((_)=>stream.stream));addTearDown(api.close);await api.restore();
  final trickle=Timer.periodic(const Duration(milliseconds:100),(_)=>stream.add([32]));
  try{await expectLater(api.foodOrder(committedOrder().id),throwsA(isA<TimeoutException>()));expect(cancelled,true);}
  finally{trickle.cancel();await stream.close();}
 },timeout:const Timeout(Duration(seconds:20)));
 test('replacement session cancels old submit stream and releases its journal queue',() async {
  initialize();var cancelled=false;final entered=Completer<void>();
  final stream=StreamController<List<int>>(onListen:(){entered.complete();},onCancel:(){cancelled=true;});
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:StreamingClient((request){
   if(request.url.path.endsWith('/auth/verify'))return Stream.value(utf8.encode(jsonEncode(fixture.session('2'))));
   if(request.url.path.endsWith('/auth/logout'))return Stream.value(utf8.encode('{}'));
   return stream.stream;
  }));addTearDown(api.close);await api.restore();
  final command=api.newFoodOrderCommand(branchId:committedOrder().branchId,quoteId:committedOrder().id,priceVersion:committedOrder().id);
  final old=api.submitFoodOrder(command),expected=expectLater(old,throwsA(isA<MobileApiException>().having((e)=>e.code,'code','SESSION_CHANGED')));
  await entered.future;stream.add([32]);await api.logout();await api.verifyOtp('+66900000002','123456');await expected;
  expect(cancelled,true);expect(await api.pendingFoodOrder(),null);
  const storage=FlutterSecureStorage();final original=await storage.read(key:'bitpos.pendingFood.${fixture.session('1')['accountId']}');
  expect(jsonDecode(original!)['idempotencyKey'],command.idempotencyKey);await stream.close();
 });
}
