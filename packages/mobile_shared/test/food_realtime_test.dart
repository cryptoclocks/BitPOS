import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_shared/mobile_api.dart';
import 'mobile_session_race_test.dart' show session;

class RealtimeClient extends http.BaseClient {
 RealtimeClient(this.body);
 final Stream<List<int>> Function(http.BaseRequest) body;
 @override Future<http.StreamedResponse> send(http.BaseRequest request) async {
  if(request.url.path.endsWith('/auth/logout'))return http.StreamedResponse(Stream.value(utf8.encode('{}')),200);
  return http.StreamedResponse(body(request),200,headers:{'content-type':'text/event-stream'});
 }
}
String snapshot({String cursor='f1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'})=>'id: $cursor\nevent: snapshot\ndata: ${jsonEncode({'serverTime':'2026-10-18T00:00:00Z','cursor':cursor,'work':{'shipmentId':'00000000-0000-4000-8000-000000000001','state':'READY_FOR_DISPATCH','version':'1','generation':'0','assignment':null,'dispatch':{'phase':'NEEDS_ATTENTION','attentionReason':null,'search':null,'reassignment':null}}})}\n\n';
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 Future<MobileApi> make(Stream<List<int>> Function(http.BaseRequest) body) async {
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session('1'))});
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:RealtimeClient(body));await api.restore();addTearDown(api.close);return api;
 }
 test('split frames produce current work then EOF clears private snapshot',() async {
  final bytes=utf8.encode(snapshot());
  final api=await make((_)=>Stream.fromIterable(bytes.map((byte)=>[byte])));
  final states=await api.watchFoodDelivery('00000000-0000-4000-8000-000000000001').take(3).toList();
  expect(states[0],isA<FoodRealtimeConnecting>());
  expect(states[1].snapshot!.work.state,'READY_FOR_DISPATCH');
  expect(states[2],isA<FoodRealtimeDisconnected>());expect(states[2].snapshot,isNull);
 });
 test('cursor mismatch never publishes a private projection',() async {
  final invalid=snapshot().replaceFirst('id: f1_a','id: f1_b');
  final api=await make((_)=>Stream.value(utf8.encode(invalid)));
  final states=await api.watchFoodDelivery('00000000-0000-4000-8000-000000000001').take(2).toList();
  expect(states.last.error,isA<FormatException>());expect(states.every((state)=>state.snapshot==null),true);
 });
 test('chunked frame budget cancels before reading provider remainder',() async {
  var remainder=false,cancelled=false;
  Stream<List<int>> body() async* {try{yield utf8.encode('event: snapshot\n');yield List.filled(40000,32);yield List.filled(30000,32);remainder=true;yield [10,10];}finally{cancelled=true;}}
  final api=await make((_)=>body());
  final states=await api.watchFoodDelivery('00000000-0000-4000-8000-000000000001').take(2).toList();
  expect(states.last.error,isA<FormatException>());expect(remainder,false);expect(cancelled,true);
 });
 test('server clear immediately removes current snapshot',() async {
  final api=await make((_)=>Stream.fromIterable([utf8.encode(snapshot()),utf8.encode('event: clear\ndata: {}\n\n')]));
  final states=await api.watchFoodDelivery('00000000-0000-4000-8000-000000000001').take(3).toList();
  expect(states[1].snapshot,isNotNull);expect(states.last.snapshot,isNull);expect(states.last.error,isA<MobileApiException>().having((error)=>error.code,'code','REALTIME_REAUTHORIZE'));
 });
 test('logout aborts established request and cannot publish old account work',() async {
  final entered=Completer<void>(),aborted=Completer<void>();
  final body=StreamController<List<int>>();
  final api=await make((request){entered.complete();(request as http.AbortableRequest).abortTrigger!.then((_){if(!aborted.isCompleted)aborted.complete();unawaited(body.close());});return body.stream;});
  final states=<FoodRealtimeState<dynamic>>[];
  final finished=Completer<void>();
  final subscription=api.watchFoodDelivery('00000000-0000-4000-8000-000000000001').listen(states.add,onDone:()=>finished.complete());
  await entered.future;body.add(utf8.encode(snapshot()));await Future<void>.delayed(Duration.zero);
  await api.logout();await aborted.future;await finished.future;
  expect(states.whereType<FoodRealtimeLive>().length,1);expect(states.last.snapshot,isNull);expect(api.signedIn,false);
  await subscription.cancel();
 });
}
