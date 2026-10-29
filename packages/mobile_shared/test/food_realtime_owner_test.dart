import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_shared/mobile_api.dart';
import 'mobile_session_race_test.dart' show session;
class OwnerClient extends http.BaseClient {
 OwnerClient(this.replacement);
 final Map<String,dynamic> replacement;
 int requests=0,refreshes=0;
 @override Future<http.StreamedResponse> send(http.BaseRequest request) async {
  if(request.url.path.endsWith('/auth/verify')||request.url.path.endsWith('/auth/refresh')){if(request.url.path.endsWith('/refresh'))refreshes++;return http.StreamedResponse(Stream.value(utf8.encode(jsonEncode(replacement))),200);}
  if(request.url.path.endsWith('/auth/logout'))return http.StreamedResponse(Stream.value(utf8.encode('{}')),200);
  requests++;if(requests==1)throw http.ClientException('Synthetic disconnect before snapshot');
  const cursor='f1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  final value={'serverTime':'2026-10-18T00:00:00Z','cursor':cursor,'work':{'offers':[],'assignment':null},'location':null};
  return http.StreamedResponse(Stream.value(utf8.encode('id: $cursor\nevent: snapshot\ndata: ${jsonEncode(value)}\n\n')),200,headers:{'content-type':'text/event-stream'});
 }
}
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 for(final sameAccount in [false,true]){
  test('retry gap cannot adopt ${sameAccount?'another logical session':'another account'}',() async {
   FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session('1'))});
   final replacement=sameAccount?{...session('2'),'accountId':session('1')['accountId']}:session('2');
   final client=OwnerClient(replacement),api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:client);addTearDown(api.close);await api.restore();
   final disconnected=Completer<void>(),done=Completer<void>();final states=<FoodRealtimeState<dynamic>>[];
   final subscription=api.watchFoodWork().listen((state){states.add(state);if(state is FoodRealtimeDisconnected&&!disconnected.isCompleted)disconnected.complete();},onDone:()=>done.complete());
   await disconnected.future;await api.logout();await api.verifyOtp('+66900000002','123456');await done.future.timeout(const Duration(seconds:2));
   expect(client.requests,1);expect(states.whereType<FoodRealtimeLive>(),isEmpty);expect(api.signedIn,true);await subscription.cancel();
  });
 }
 test('same logical session refresh preserves watcher through a subsequent reconnect',() async {
  final original={...session('1'),'accessExpiresAt':DateTime.now().add(const Duration(seconds:5)).toUtc().toIso8601String()};
  final rotated={...session('1'),'accessToken':List.filled(43,'r').join(),'refreshToken':List.filled(43,'s').join()};
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(original)});
  final client=OwnerClient(rotated),api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:client);addTearDown(api.close);await api.restore();
  final live=await api.watchFoodWork().firstWhere((state)=>state is FoodRealtimeLive).timeout(const Duration(seconds:3));
  expect(live.snapshot!.work.assignment,isNull);expect(client.refreshes,1);expect(client.requests,2);expect(api.signedIn,true);
 });
}
