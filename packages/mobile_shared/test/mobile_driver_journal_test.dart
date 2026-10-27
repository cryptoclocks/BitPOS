import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'mobile_session_race_test.dart' as fixture;
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 void initialize()=>FlutterSecureStorage.setMockInitialValues({'bitpos.deviceId':'00000000-0000-4000-8000-000000000099','bitpos.mobileSession':jsonEncode(fixture.session('1'))});
 final application=DriverApplication(displayName:'Fixture',licenseExpiresAt:'2027-01-01T00:00:00Z',vehicleType:'MOTORCYCLE',plate:'FIXTURE',brand:'Fixture',color:'Purple',registrationExpiresAt:'2027-01-01T00:00:00Z');
 test('lost driver commit response survives restart and exact replay clears recovery',() async{
  initialize();var committed=false;final bodies=<String>[];
  MobileApi make()=>MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request) async{bodies.add(request.body);if(!committed){committed=true;throw http.ClientException('fixture response lost after commit');}return http.Response(jsonEncode({'driverId':'00000000-0000-4000-8000-000000000077','version':'1'}),200);}));
  final first=make();await first.restore();final command=first.driverApplicationCommand(null,application);await expectLater(first.submitDriverMutation(command),throwsA(isA<http.ClientException>()));first.close();
  final restarted=make();addTearDown(restarted.close);await restarted.restore();final saved=await restarted.pendingDriverMutation();expect(saved!.toJson(),command.toJson());await expectLater(restarted.submitDriverMutation(restarted.driverApplicationCommand(null,application)),throwsA(isA<MobileApiException>()));await restarted.submitDriverMutation(saved);expect(await restarted.pendingDriverMutation(),isNull);expect(bodies,[jsonEncode(command.body),jsonEncode(command.body)]);
 });
 test('definitive invalid application releases journal but malformed success retains original',() async{
  initialize();var invalid=true;final api=MobileApi(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true,client:MockClient((request) async=>invalid?http.Response(jsonEncode({'error':{'code':'INVALID_REQUEST','retryable':false,'message':'INVALID_REQUEST'}}),422):http.Response('{}',200)));addTearDown(api.close);await api.restore();final command=api.driverApplicationCommand(null,application);
  await expectLater(api.submitDriverMutation(command),throwsA(isA<MobileApiException>().having((e)=>e.code,'code','INVALID_REQUEST')));expect(await api.pendingDriverMutation(),isNull);invalid=false;await expectLater(api.submitDriverMutation(command),throwsFormatException);expect((await api.pendingDriverMutation())!.toJson(),command.toJson());
 });
}
