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
 testWidgets('native safety report retains custody, shows ACK history and separately authorized resume',(tester)async{
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit local fixture required');
  final session=jsonDecode(utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))));
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session),'bitpos.deviceId':'00000000-0000-4000-8000-000000000081'});
  final api=MobileApi(base:Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),fixture:true);await api.restore();addTearDown(api.close);
  final initial=(await api.foodDriverWork()).assignment as FoodDriverAssignment;expect(initial.state,'AT_PICKUP');expect(initial.proofs,isNotEmpty);
  await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:FoodWorkPage(api:api,thai:false)));
  final report=find.byKey(const ValueKey('food-report-incident'));final ready=DateTime.now().add(const Duration(seconds:30));
  while(report.evaluate().isEmpty&&DateTime.now().isBefore(ready)){await tester.pump(const Duration(milliseconds:200));}
  await tester.scrollUntilVisible(report,350);await tester.ensureVisible(report);await tester.pumpAndSettle();expect(report.hitTestable(),findsOneWidget);await tester.tap(report);await tester.pumpAndSettle();
  await tester.tap(find.byType(DropdownButtonFormField<String>));await tester.pumpAndSettle();await tester.tap(find.text('Urgent safety concern').last);await tester.pumpAndSettle();
  await tester.enterText(find.byKey(const ValueKey('food-incident-body')),'AVD synthetic safety report; no emergency contact');await tester.pump();await tester.tap(find.byKey(const ValueKey('food-incident-send')));await tester.pump();
  final confirmed=find.byKey(const ValueKey('food-incident-confirmed'));final deadline=DateTime.now().add(const Duration(seconds:30));
  while(confirmed.evaluate().isEmpty&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}
  expect(confirmed,findsOneWidget);expect(await api.pendingFoodDispatch(),isNull);
  final restricted=(await api.foodDriverWork()).assignment as FoodDriverRestrictedAssignment;expect(restricted.id,initial.id);expect(restricted.reason,'INCIDENT');expect(restricted.custodyPhase,'PREPICKUP');
  await tester.ensureVisible(confirmed);await tester.pump(const Duration(milliseconds:300));debugPrint('BITPOS_INCIDENT081_RECORDED');
  final ackDeadline=DateTime.now().add(const Duration(seconds:30));bool acknowledged=false;
  while(!acknowledged&&DateTime.now().isBefore(ackDeadline)){acknowledged=(await api.foodIncidents(initial.id)).incidents.single.acknowledgedAt!=null;if(!acknowledged)await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:500)));}
  expect(acknowledged,true);expect((await api.foodDriverWork()).assignment,isA<FoodDriverRestrictedAssignment>());
  final history=find.byKey(const ValueKey('food-incident-history'));await tester.scrollUntilVisible(history,300,scrollable:find.descendant(of:find.byType(ListView).first,matching:find.byType(Scrollable)).first);await tester.ensureVisible(history);await tester.pump(const Duration(milliseconds:300));await tester.tap(history);await tester.pump(const Duration(milliseconds:300));
  final ack=find.text('Acknowledged; not authorization to resume');final historyDeadline=DateTime.now().add(const Duration(seconds:30));while(ack.evaluate().isEmpty&&DateTime.now().isBefore(historyDeadline)){await tester.pump(const Duration(milliseconds:200));}expect(ack,findsOneWidget);debugPrint('BITPOS_INCIDENT081_ACK_VISIBLE');
  await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:2)));await tester.tap(find.text('Close').last);await tester.pump(const Duration(milliseconds:300));
  final resumeDeadline=DateTime.now().add(const Duration(seconds:30));FoodDriverDuty? current;
  while(current is! FoodDriverAssignment&&DateTime.now().isBefore(resumeDeadline)){current=(await api.foodDriverWork()).assignment;if(current is! FoodDriverAssignment)await tester.runAsync(()=>Future<void>.delayed(const Duration(milliseconds:500)));}
  expect(current,isA<FoodDriverAssignment>());expect((current as FoodDriverAssignment).id,initial.id);expect(current.state,'AT_PICKUP');expect(current.proofs,isEmpty);
  final refresh=find.byIcon(Icons.refresh);await tester.scrollUntilVisible(refresh,-350,scrollable:find.descendant(of:find.byType(ListView).first,matching:find.byType(Scrollable)).first);await tester.ensureVisible(refresh);await tester.pump(const Duration(milliseconds:300));expect(refresh.hitTestable(),findsOneWidget);await tester.tap(refresh);await tester.pump(const Duration(milliseconds:500));debugPrint('BITPOS_INCIDENT081_RESUMED');expect(tester.takeException(),isNull);
  await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:3)));
 });
}
