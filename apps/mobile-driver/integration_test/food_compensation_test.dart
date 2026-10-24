import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/food_compensation_page.dart';
void main(){
 IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('owned compensation actual SDK finalized then live revoked session clears result',(tester)async{
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit local fixture required');
  const assignment=String.fromEnvironment('BITPOS_TEST_ASSIGNMENT_ID');final session=jsonDecode(utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))));
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session),'bitpos.deviceId':'00000000-0000-4000-8000-000000000134'});
  final api=MobileApi(base:Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),fixture:true);await api.restore();addTearDown(api.close);
  final initial=await api.foodDriverCompensation(assignment);expect(initial.assignmentId,assignment);expect(initial.execution?.state,'FINALIZED');expect(initial.execution?.fundsTransferred,true);
  await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:DriverFoodCompensationPage(api:api,assignmentId:assignment,thai:false)));
  Future<void> waitText(String text)async{final deadline=DateTime.now().add(const Duration(seconds:30));while(find.text(text).evaluate().isEmpty&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}expect(find.text(text),findsOneWidget);}
  await waitText('Check compensation');await tester.tap(find.text('Check compensation'));await waitText('Compensation finalized; transfer verified');debugPrint('BITPOS_DRIVER_COMPENSATION_FINALIZED');
  await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:2)));await tester.tap(find.text('Check compensation'));await waitText('Sign in again');expect(find.text('Compensation finalized; transfer verified'),findsNothing);expect(tester.takeException(),isNull);debugPrint('BITPOS_DRIVER_COMPENSATION_REVOKED');
 });
}
