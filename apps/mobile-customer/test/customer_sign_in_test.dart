import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:bitpos_customer/main.dart';
import 'package:bitpos_customer/presentation/customer_sign_in.dart';
import 'notification_owner_test.dart' show PushNative;
class SignInApi extends MobileApi {
 SignInApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 final requested=<String>[],verified=<String>[];
 @override bool get signedIn=>false;
 @override Future<void> restore()async{}
 @override Future<void> requestOtp(String phone)async{requested.add(phone);}
 @override Future<void> verifyOtp(String phone,String code)async{verified.add('$phone:$code');throw const MobileApiException('AUTH_REQUIRED',401);}
}
void main(){
 testWidgets('phone and OTP use actual typed value, masked destination and explicit retry',(tester)async{
  await tester.binding.setSurfaceSize(const Size(390,844));addTearDown(()=>tester.binding.setSurfaceSize(null));
  FlutterSecureStorage.setMockInitialValues({});final api=SignInApi();
  await tester.pumpWidget(MaterialApp(home:CustomerSessionPage(api:api,pushNative:PushNative())));await tester.pumpAndSettle();
  await tester.ensureVisible(find.byKey(const ValueKey('customer-welcome-start')));await tester.tap(find.byKey(const ValueKey('customer-welcome-start')));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextFormField).first,'+66900000001');
  await tester.tap(find.text('ขอรหัสเข้าสู่ระบบ'));await tester.pumpAndSettle();
  expect(api.requested,['+66900000001']);expect(find.text('ส่งรหัสไปที่ +66 ••• 0001'),findsOneWidget);
  final otp=find.byType(TextFormField).last;
  await tester.ensureVisible(otp);await tester.enterText(otp,'123');
  await tester.ensureVisible(find.text('ยืนยันรหัส'));await tester.tap(find.text('ยืนยันรหัส'));await tester.pumpAndSettle();expect(api.verified,isEmpty);
  await tester.ensureVisible(otp);await tester.enterText(otp,'123456');
  FocusManager.instance.primaryFocus?.unfocus();await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('ยืนยันรหัส'));await tester.tap(find.text('ยืนยันรหัส'));await tester.pumpAndSettle();
  expect(api.verified,['+66900000001:123456']);
  expect(find.text('กรุณาเข้าสู่ระบบใหม่หรือใช้รหัสที่ถูกต้อง'),findsOneWidget);
  await tester.ensureVisible(find.text('เปลี่ยนหมายเลข / ขอรหัสใหม่'));await tester.tap(find.text('เปลี่ยนหมายเลข / ขอรหัสใหม่'));await tester.pumpAndSettle();
  expect(find.byType(TextFormField),findsOneWidget);expect(api.requested.length,1);
  expect(tester.takeException(),isNull);
  await tester.pumpWidget(const SizedBox.shrink());await tester.pumpAndSettle();
 });
 testWidgets('U02 and U03 headings keep approved type and vertical lead', (tester) async {
  await tester.pumpWidget(const MaterialApp(home:Scaffold(body:CustomerSignInHeading(thai:false,sent:false,phone:''))));
  expect(tester.getTopLeft(find.text('Welcome back')).dy,40);
  expect(tester.widget<Text>(find.text('Welcome back')).style!.fontSize,27);
  await tester.pumpWidget(const MaterialApp(home:Scaffold(body:CustomerSignInHeading(thai:false,sent:true,phone:'+66900000001'))));
  expect(find.text('Code sent to +66 ••• 0001'),findsOneWidget);
  expect(tester.takeException(),isNull);
 });
}
