import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_push_native.dart';

void main(){
 test('first permission request remains distinguishable from denied and blocked channels',(){
  expect(MobilePushPermission.fromSystem(AuthorizationStatus.notDetermined,notificationsEnabled:false),MobilePushPermission.notDetermined);
  expect(MobilePushPermission.fromSystem(AuthorizationStatus.denied),MobilePushPermission.denied);
  expect(MobilePushPermission.fromSystem(AuthorizationStatus.authorized,channelEnabled:false),MobilePushPermission.denied);
  expect(MobilePushPermission.fromSystem(AuthorizationStatus.authorized,notificationsEnabled:false),MobilePushPermission.denied);
  expect(MobilePushPermission.fromSystem(AuthorizationStatus.authorized,notificationsEnabled:true,channelEnabled:true),MobilePushPermission.authorized);
  expect(MobilePushPermission.fromSystem(AuthorizationStatus.provisional,notificationsEnabled:true),MobilePushPermission.provisional);
 });
 test('opaque envelope rejects wrong types and injected facts without throwing',(){
  final valid=<String,dynamic>{'eventId':'7a27fd07-5e74-4cb4-81e1-6c85c22d9431','bindingId':'6fe093da-78ec-4c84-8ec6-640a2ca468b4','bindingGeneration':'1','app':'CUSTOMER'};
  final envelope=MobilePushEnvelope.parse(valid)!;
  expect(envelope.eventId,valid['eventId']);expect(envelope.generation,'1');
  for(final field in valid.keys){expect(MobilePushEnvelope.parse({...valid,field:1}),isNull);expect(MobilePushEnvelope.parse({...valid,field:null}),isNull);}
  expect(MobilePushEnvelope.parse({...valid,'paid':true}),isNull);
  expect(MobilePushEnvelope.parse({...valid,'bindingGeneration':'0'}),isNull);
  expect(MobilePushEnvelope.parse({...valid,'app':'MERCHANT'}),isNull);
 });
}
