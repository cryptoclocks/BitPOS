import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/driver_mutation.dart';
import 'package:bitpos_driver/main.dart';
class DriverApi extends MobileApi{
 DriverApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 bool active=true,revoke=false,empty=false,expired=false,online=true;DateTime expiry=DateTime.now().add(const Duration(seconds:2));
 @override bool get signedIn=>active;
 @override Future<void> restore() async{}
 @override Future<DriverMutation?> pendingDriverMutation() async=>null;
 @override Future<void> requestOtp(String phone) async{}
 @override Future<void> verifyOtp(String phone,String code) async{active=true;empty=true;}
 @override Future<void> submitDriverMutation(DriverMutation mutation) async{
  if(mutation is DriverAvailabilityMutation){online=mutation.command.online;expiry=DateTime.now().add(const Duration(seconds:90));}
 }
 @override Future<DriverProfileResult> driverProfile() async{
  if(revoke){active=false;revoke=false;throw const MobileApiException('AUTH_REQUIRED',401);}
  final document=DateTime.now().add(Duration(days:expired?-1:30)).toUtc().toIso8601String();
  return DriverProfileResult(driver:empty?null:DriverProfile(id:'11111111-1111-4111-8111-111111111111',version:'1',status:'APPROVED',verifiedUntil:DateTime.now().add(const Duration(days:2)).toUtc().toIso8601String(),decisionReason:'',application:DriverApplication(displayName:'Private A',licenseExpiresAt:document,vehicleType:'CAR',plate:'PRIVATE-A',brand:'Secret brand',color:'Purple',registrationExpiresAt:document),availability:DriverAvailability(version:'1',requestedOnline:true,online:online,heartbeatExpiresAt:expiry.toUtc().toIso8601String(),verificationCurrent:true)));
 }
}
class InitiallyUnavailableProfileApi extends DriverApi {
 bool unavailable=true;
 @override Future<DriverProfileResult> driverProfile()async{if(unavailable){throw const MobileApiException('RESPONSE_UNAVAILABLE',503);}return super.driverProfile();}
}

void main(){
 testWidgets('restored session refusal returns directly to OTP without driver branch',(tester) async{
  final api=DriverApi()..revoke=true;addTearDown(api.close);await tester.pumpWidget(MaterialApp(home:DriverSessionPage(api:api)));await tester.pumpAndSettle();await tester.tap(find.text('English'));await tester.pump();expect(find.text('Request OTP'),findsOneWidget);expect(find.text('Food driver account'),findsNothing);await tester.pumpWidget(const MaterialApp());
 });
 testWidgets('authentication loss and new blank account erase previous driver application',(tester) async{
  final api=DriverApi();addTearDown(api.close);await tester.pumpWidget(MaterialApp(home:DriverSessionPage(api:api)));await tester.pumpAndSettle();await tester.tap(find.text('English'));await tester.pumpAndSettle();api.revoke=true;
  await tester.scrollUntilVisible(find.text('Refresh server state'),300,scrollable:find.byType(Scrollable).first);await tester.tap(find.text('Refresh server state'));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextFormField).first,'+66900000001');await tester.ensureVisible(find.text('Request OTP'));await tester.tap(find.text('Request OTP'));await tester.pumpAndSettle();await tester.enterText(find.byType(TextFormField).last,'123456');FocusManager.instance.primaryFocus?.unfocus();await tester.pumpAndSettle();await tester.ensureVisible(find.text('Verify OTP'));await tester.tap(find.text('Verify OTP'));await tester.pumpAndSettle();
  expect(find.text('Private A'),findsNothing);expect(find.text('PRIVATE-A'),findsNothing);expect(find.text('Secret brand'),findsNothing);expect(find.text('Car'),findsNothing);
  await tester.scrollUntilVisible(find.text('License expiry: —'),400,scrollable:find.byType(Scrollable).first);expect(find.text('License expiry: —'),findsOneWidget);expect(find.text('Registration expiry: —'),findsOneWidget);
 });
 testWidgets('known availability deadline cannot remain online without refresh',(tester) async{
  final api=DriverApi();addTearDown(api.close);await tester.pumpWidget(MaterialApp(home:DriverSessionPage(api:api)));await tester.pumpAndSettle();await tester.tap(find.text('English'));await tester.pump();await tester.scrollUntilVisible(find.text('Online according to server'),200,scrollable:find.byType(Scrollable).first);expect(find.text('Online according to server'),findsOneWidget);await tester.pump(const Duration(seconds:3));expect(find.text('Online according to server'),findsNothing);await tester.pumpWidget(const MaterialApp());
 });
 testWidgets('fresh offline snapshot permits renewal after previous heartbeat expired',(tester) async{
  final api=DriverApi()..online=false..expiry=DateTime.now().subtract(const Duration(seconds:1));addTearDown(api.close);await tester.pumpWidget(MaterialApp(home:DriverSessionPage(api:api)));await tester.pumpAndSettle();await tester.tap(find.text('English'));await tester.pump();await tester.scrollUntilVisible(find.text('Offline according to server'),200,scrollable:find.byType(Scrollable).first);expect(find.text('Offline according to server'),findsOneWidget);
  await tester.scrollUntilVisible(find.text('Go online / renew'),300,scrollable:find.byType(Scrollable).first);await tester.ensureVisible(find.widgetWithText(FilledButton,'Go online / renew'));await tester.pumpAndSettle();await tester.tap(find.text('Go online / renew'));await tester.pumpAndSettle();await tester.scrollUntilVisible(find.text('Online according to server'),-300,scrollable:find.byType(Scrollable).first);expect(find.text('Online according to server'),findsOneWidget);expect(find.text('Offline according to server'),findsNothing);await tester.pumpWidget(const MaterialApp());
 });
 testWidgets('expired document can open renewal picker without assertion',(tester) async{
  final api=DriverApi()..expired=true;addTearDown(api.close);await tester.pumpWidget(MaterialApp(home:DriverSessionPage(api:api)));await tester.pumpAndSettle();await tester.tap(find.text('English'));await tester.pump();final button=find.textContaining('License expiry:');await tester.scrollUntilVisible(button,400,scrollable:find.byType(Scrollable).first);await tester.pumpAndSettle();await tester.ensureVisible(button);await tester.pumpAndSettle();await tester.tap(button);await tester.pumpAndSettle();expect(tester.takeException(),isNull);expect(find.byType(DatePickerDialog),findsOneWidget);
 });
 testWidgets('verified profile shows real identity with documents collapsed until opened',(tester)async{
  final api=DriverApi();addTearDown(api.close);await tester.pumpWidget(MaterialApp(home:DriverSessionPage(api:api)));await tester.pumpAndSettle();await tester.tap(find.text('English'));await tester.pump();
  expect(find.text('Private A'),findsOneWidget);await tester.scrollUntilVisible(find.text('Vehicle and documents'),400,scrollable:find.byType(Scrollable).first);await tester.pumpAndSettle();
  expect(find.text('Vehicle plate'),findsNothing);await tester.tap(find.text('Vehicle and documents'));await tester.pumpAndSettle();
  await tester.scrollUntilVisible(find.text('Vehicle plate'),200,scrollable:find.byType(Scrollable).first);expect(find.text('Vehicle plate'),findsOneWidget);
  await tester.pumpWidget(const MaterialApp());
 });

 testWidgets('unknown profile cannot look like a new blank application and refresh recovers',(tester)async{
  final api=InitiallyUnavailableProfileApi();addTearDown(api.close);await tester.pumpWidget(MaterialApp(home:DriverSessionPage(api:api)));await tester.pumpAndSettle();await tester.tap(find.text('English'));await tester.pump();
  expect(find.textContaining('Profile not loaded.'),findsOneWidget);expect(find.text('Display name'),findsNothing);expect(find.text('Vehicle and documents'),findsNothing);
  api.unavailable=false;await tester.scrollUntilVisible(find.text('Refresh server state'),200,scrollable:find.byType(Scrollable).first);await tester.pumpAndSettle();await tester.tap(find.text('Refresh server state'));await tester.pumpAndSettle();
  await tester.scrollUntilVisible(find.text('Private A'),-200,scrollable:find.byType(Scrollable).first);expect(find.text('Private A'),findsOneWidget);expect(find.textContaining('Profile not loaded.'),findsNothing);await tester.pumpWidget(const MaterialApp());
 });

}
