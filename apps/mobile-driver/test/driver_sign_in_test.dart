import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:bitpos_driver/main.dart';
class SignInApi extends MobileApi{
 SignInApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 final requested=<String>[],verified=<String>[];
 @override bool get signedIn=>false;
 @override Future<void>restore()async{}
 @override Future<void>requestOtp(String phone)async{requested.add(phone);}
 @override Future<void>verifyOtp(String phone,String code)async{verified.add('$phone:$code');throw const MobileApiException('AUTH_REQUIRED',401);}
}
void main(){testWidgets('rider invalid OTP retains challenge and change-number never automatically resends',(tester)async{
 await tester.binding.setSurfaceSize(const Size(390,844));addTearDown(()=>tester.binding.setSurfaceSize(null));FlutterSecureStorage.setMockInitialValues({});final api=SignInApi();
 await tester.pumpWidget(MaterialApp(home:DriverSessionPage(api:api)));await tester.pumpAndSettle();
 await tester.ensureVisible(find.byKey(const ValueKey('driver-welcome-start')));await tester.tap(find.byKey(const ValueKey('driver-welcome-start')));await tester.pumpAndSettle();
 await tester.tap(find.text('ขอ OTP'));await tester.pumpAndSettle();expect(api.requested,isEmpty);
 await tester.enterText(find.byType(TextFormField).first,'+66900000001');await tester.tap(find.text('ขอ OTP'));await tester.pumpAndSettle();expect(api.requested,['+66900000001']);
 await tester.enterText(find.byType(TextFormField).last,'123');await tester.ensureVisible(find.text('ยืนยัน OTP'));await tester.tap(find.text('ยืนยัน OTP'));await tester.pumpAndSettle();expect(api.verified,isEmpty);
 await tester.enterText(find.byType(TextFormField).last,'123456');FocusManager.instance.primaryFocus?.unfocus();await tester.pumpAndSettle();await tester.ensureVisible(find.text('ยืนยัน OTP'));await tester.tap(find.text('ยืนยัน OTP'));await tester.pumpAndSettle();
 expect(api.verified,['+66900000001:123456']);expect(find.text('ยืนยัน OTP'),findsOneWidget);expect(api.requested.length,1);
 await tester.ensureVisible(find.text('เปลี่ยนหมายเลข / ขอรหัสใหม่'));await tester.tap(find.text('เปลี่ยนหมายเลข / ขอรหัสใหม่'));await tester.pumpAndSettle();expect(find.byType(TextFormField),findsOneWidget);expect(api.requested.length,1);expect(tester.takeException(),isNull);
 await tester.pumpWidget(const SizedBox.shrink());await tester.pumpAndSettle();
});}
