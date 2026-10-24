import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/food_work_page.dart';
void main(){
 IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('actual local driver withdrawal confirms persisted release from native surface',(tester)async{
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit local fixture required');
  final session=jsonDecode(utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))));
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session),'bitpos.deviceId':'00000000-0000-4000-8000-000000000080'});
  final api=MobileApi(base:Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),fixture:true);await api.restore();addTearDown(api.close);
  final initial=await api.foodDriverWork();expect(initial.assignment,isA<FoodDriverAssignment>());
  await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:FoodWorkPage(api:api,thai:false)));
  final reason=find.text('Choose reason to request withdrawal');
  final deadline=DateTime.now().add(const Duration(seconds:30));
  while(reason.evaluate().isEmpty&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}
  await tester.scrollUntilVisible(reason,350);await tester.ensureVisible(reason);await tester.pumpAndSettle();
  expect(reason.hitTestable(),findsOneWidget);await tester.tap(reason);await tester.pumpAndSettle();
  await tester.tap(find.text('Safety'));await tester.pump();
  final confirmed=find.byKey(const ValueKey('food-withdrawal-confirmed'));
  final confirmationDeadline=DateTime.now().add(const Duration(seconds:30));
  while(confirmed.evaluate().isEmpty&&DateTime.now().isBefore(confirmationDeadline)){await tester.pump(const Duration(milliseconds:200));}
  expect(confirmed,findsOneWidget);expect((await api.foodDriverWork()).assignment,isNull);expect(await api.pendingFoodDispatch(),isNull);expect(tester.takeException(),isNull);
  await tester.ensureVisible(confirmed);await tester.pumpAndSettle();debugPrint('BITPOS_WITHDRAWAL080_CONFIRMED');
  await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:3)));
 });
}
