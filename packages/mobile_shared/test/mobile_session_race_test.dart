import 'dart:async';
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';

Map<String,dynamic> session(String digit)=>{'accountId':'00000000-0000-4000-8000-00000000000$digit','sessionId':'00000000-0000-4000-8000-00000000001$digit','accessToken':List.filled(43,digit).join(),'refreshToken':List.filled(43,digit).join(),'accessExpiresAt':'2099-01-01T00:00:00Z','refreshExpiresAt':'2099-02-01T00:00:00Z'};
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 test('late old-account unauthorized response cannot revoke replacement account',() async {
  FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode(session('1'))});
  final entered=Completer<void>(),late=Completer<http.Response>();
  final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request) async {
   if(request.url.path.endsWith('/account')){entered.complete();return late.future;}
   if(request.url.path.endsWith('/auth/verify'))return http.Response(jsonEncode(session('2')),200);
   return http.Response('{}',200);
  }));addTearDown(api.close);
  await api.restore();
  final old=api.account();
  final rejection=expectLater(old,throwsA(isA<MobileApiException>().having((e)=>e.code,'code','SESSION_CHANGED')));
  await entered.future;
  await api.logout();await api.verifyOtp('+66900000002','123456');
  late.complete(http.Response('{"error":{"code":"AUTH_REQUIRED"}}',401));await rejection;
  expect(api.signedIn,isTrue);
  const storage=FlutterSecureStorage();
  final saved=jsonDecode((await storage.read(key:'bitpos.mobileSession'))!) as Map;
  expect(saved['accountId'],session('2')['accountId']);
 });
}
