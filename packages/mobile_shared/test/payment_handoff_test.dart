import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/payment_handoff.dart';

void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 final token=List.filled(43,'a').join();
 final capability='https://pay.cashlessthailand.com/pay/$token';
 test('fixture checkout retains original capability only on local sandbox origin',(){
  final handoff=PaymentHandoff(fixture:true,destinationOrigin:'http://10.0.2.2:4321');
  expect(handoff.destination(capability),Uri.parse('http://10.0.2.2:4321/pay/$token'));
  for(final origin in ['https://pay.cashlessthailand.com','http://attacker.invalid:4321','http://10.0.2.2:4321/redirect','http://user@10.0.2.2:4321','ftp://10.0.2.2:4321']){
   expect(()=>PaymentHandoff(fixture:true,destinationOrigin:origin).destination(capability),throwsA(isA<MobileApiException>()));
  }
 });
 test('checkout rejects substituted capability origins, paths and redirect parameters',(){
  final handoff=PaymentHandoff(fixture:false,destinationOrigin:'https://pay.cashlessthailand.com');
  expect(handoff.destination(capability),Uri.parse(capability));
  for(final bad in ['https://pay.cashlessthailand.com.attacker.invalid/pay/$token','https://attacker.invalid/pay/$token','https://user@pay.cashlessthailand.com/pay/$token','$capability?next=https://attacker.invalid','$capability#callback','/pay/$token','javascript:alert(1)','https://pay.cashlessthailand.com/pay/short']){
   expect(()=>handoff.destination(bad),throwsA(isA<MobileApiException>()));
  }
 });
 test('missing checkout configuration cannot silently use production',(){
  expect(()=>PaymentHandoff(fixture:true,destinationOrigin:'').destination(capability),throwsA(isA<MobileApiException>()));
 });
 for(final platformError in [false,true]){
  test('unavailable browser maps safely to recovery error platformException=$platformError',() async {
   const channel=MethodChannel('plugins.flutter.io/url_launcher');
   final messenger=TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
   messenger.setMockMethodCallHandler(channel,(call) async {
    if(platformError)throw PlatformException(code:'ACTIVITY_NOT_FOUND',message:'private native diagnostic');
    return false;
   });
   addTearDown(()=>messenger.setMockMethodCallHandler(channel,null));
   await expectLater(PaymentHandoff(fixture:true,destinationOrigin:'http://10.0.2.2:4321').open(capability),throwsA(isA<MobileApiException>().having((error)=>error.code,'code','PAYMENT_APP_UNAVAILABLE')));
  });
 }
}
