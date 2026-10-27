import 'dart:convert';
import 'package:flutter/material.dart';import 'package:flutter_secure_storage/flutter_secure_storage.dart';import 'package:flutter_test/flutter_test.dart';import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/bitpos_theme.dart';import 'package:bitpos_customer/help_page.dart';
void main(){final binding=IntegrationTestWidgetsFlutterBinding.ensureInitialized();testWidgets('actual support case customer and staff messages logout',(tester)async{
 if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Local fixture required');
 final session=jsonDecode(utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))));
 FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session),'bitpos.deviceId':const String.fromEnvironment('BITPOS_TEST_DEVICE_ID')});
 final api=MobileApi(base:Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),fixture:true);addTearDown(api.close);await api.restore();final owner=ValueNotifier(true);addTearDown(owner.dispose);
 await tester.pumpWidget(MaterialApp(debugShowCheckedModeBanner:false,theme:BitPosTheme.light(),home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()=>Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>HelpPage(api:api,owner:owner,thai:true,onAuthenticationRequired:()=>throw StateError('Unexpected auth loss')))),child:const Text('Open support fixture'))))));
 await tester.tap(find.text('Open support fixture'));await tester.pump();
 Future<void> waitUntil(bool Function() condition)async{for(var i=0;i<100&&!condition();i++){await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:100)));await tester.pump(const Duration(milliseconds:50));}expect(condition(),true);}
 await waitUntil(()=>find.text('ติดต่อเจ้าหน้าที่').evaluate().isNotEmpty);await tester.pumpAndSettle();debugPrint('BITPOS_SUPPORT_HELP_VISIBLE');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:1)));await tester.tap(find.text('ติดต่อเจ้าหน้าที่'));await tester.pump();
 await waitUntil(()=>find.byType(TextField).evaluate().length==2&&find.byType(LinearProgressIndicator).evaluate().isEmpty);
 await tester.enterText(find.byType(TextField).first,'AVD support enquiry');await tester.enterText(find.byType(TextField).last,'Customer AVD question');await tester.ensureVisible(find.text('ส่งคำร้อง / ข้อความ'));await tester.tap(find.text('ส่งคำร้อง / ข้อความ'));await tester.pump();
 await waitUntil(()=>find.text('AVD support enquiry').evaluate().isNotEmpty&&find.byType(LinearProgressIndicator).evaluate().isEmpty);
 await tester.ensureVisible(find.text('AVD support enquiry'));await tester.tap(find.text('AVD support enquiry'));await tester.pump();await waitUntil(()=>find.text('Customer AVD question').evaluate().isNotEmpty);debugPrint('BITPOS_SUPPORT_CUSTOMER_VISIBLE');
 for(var i=0;i<20&&find.text('Support AVD answer').evaluate().isEmpty;i++){await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:400)));await tester.ensureVisible(find.text('โหลดใหม่'));await tester.tap(find.text('โหลดใหม่'));await tester.pump();await waitUntil(()=>find.byType(LinearProgressIndicator).evaluate().isEmpty);}
 expect(find.text('Support AVD answer'),findsOneWidget);expect(find.textContaining('ทีมช่วยเหลือ'),findsOneWidget);
 await tester.enterText(find.byType(TextField).last,'Customer follow-up');await tester.ensureVisible(find.text('ส่งคำร้อง / ข้อความ'));await tester.tap(find.text('ส่งคำร้อง / ข้อความ'));await tester.pump();await waitUntil(()=>find.text('Customer follow-up').evaluate().isNotEmpty&&find.byType(LinearProgressIndicator).evaluate().isEmpty);
 FocusManager.instance.primaryFocus?.unfocus();await tester.pumpAndSettle();await tester.scrollUntilVisible(find.text('Support AVD answer'),-180,scrollable:find.byType(Scrollable).first);debugPrint('BITPOS_SUPPORT_THREAD_VISIBLE');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:2)));
 await tester.runAsync(()=>api.logout());owner.value=false;await tester.pumpAndSettle();expect(find.text('Open support fixture'),findsOneWidget);expect(find.text('Support AVD answer'),findsNothing);
 binding.reportData={'status':'PASS_ACTUAL_AVD_SUPPORT_CUSTOMER_STAFF_LOGOUT','physicalTesting':'deferred_by_user_2026-10-16'};
});}
