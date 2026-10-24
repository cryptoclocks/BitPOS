import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';
void main(){
 IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('actual dispatch release, matching and manual recovery replace customer private custody state',(tester)async{
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit disposable fixture required');
  const orderId=String.fromEnvironment('BITPOS_TEST_ORDER_ID');
  final session=jsonDecode(utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))));
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session),'bitpos.deviceId':'00000000-0000-4000-8000-000000000086'});
  final api=MobileApi(base:Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),fixture:true);await api.restore();addTearDown(api.close);
  final original=await api.foodCustomerWork(orderId);expect(original.dispatch.phase,'ASSIGNED');expect(original.assignment,isNotNull);
  await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:FoodDeliveryPage(api:api,orderId:orderId,thai:false,onAuthenticationRequired:()=>throw StateError('Fixture authentication lost'))));
  Future<void> waitText(String text)async{final until=DateTime.now().add(const Duration(seconds:40));while(find.text(text).evaluate().isEmpty&&DateTime.now().isBefore(until)){await tester.pump(const Duration(milliseconds:200));}expect(find.text(text),findsOneWidget);}
  await waitText('Assigned delivery');debugPrint('BITPOS_PROGRESS086_ASSIGNED');
  await waitText('Matching a driver');final matching=await api.foodCustomerWork(orderId);expect(matching.assignment,isNull);expect(matching.dispatch.reassignment?.count,1);expect(matching.dispatch.search,isNotNull);expect(find.textContaining('Pre-pickup assignments released: 1'),findsOneWidget);expect(find.text('Issue delivery proof'),findsNothing);expect(find.text('Replace delivery proof'),findsNothing);debugPrint('BITPOS_PROGRESS086_MATCHING');
  await waitText('Dispatch needs staff assistance');final manual=await api.foodCustomerWork(orderId);expect(manual.dispatch.attentionReason,'MANUAL');expect(manual.assignment,isNull);expect(find.textContaining('This does not cancel the order or refund payment.'),findsOneWidget);expect(tester.takeException(),isNull);debugPrint('BITPOS_PROGRESS086_MANUAL');
  await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:3)));
 });
}
