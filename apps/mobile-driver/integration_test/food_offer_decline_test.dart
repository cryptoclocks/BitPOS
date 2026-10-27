import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_driver/food_work_page.dart';

void main(){
 final binding=IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('AVD owner refuses actual local canonical offer',(tester)async{
  if(!const bool.fromEnvironment('BITPOS_FIXTURE'))throw StateError('Explicit local fixture required');
  final session=jsonDecode(utf8.decode(base64Decode(const String.fromEnvironment('BITPOS_TEST_SESSION_BASE64'))));
  FlutterSecureStorage.setMockInitialValues({'bitpos.mobileSession':jsonEncode(session),'bitpos.deviceId':'00000000-0000-4000-8000-000000000077'});
  final api=MobileApi(base:Uri.parse(const String.fromEnvironment('BITPOS_MOBILE_API')),fixture:true);await api.restore();addTearDown(api.close);
  expect(api.signedIn,isTrue,reason:'Synthetic session must satisfy actual generated token/session contract before UI admission');
  Future<void> waitFor(Finder finder)async{
   final deadline=DateTime.now().add(const Duration(seconds:45));
   while(finder.evaluate().isEmpty&&DateTime.now().isBefore(deadline)){
    await tester.pump(const Duration(milliseconds:100));
    if(find.byType(ListView).evaluate().isNotEmpty){await tester.drag(find.byType(ListView).last,const Offset(0,-300));await tester.pump();}
   }
   if(finder.evaluate().isEmpty){debugPrint('BITPOS_OFFER077_FAILURE_TEXT: ${find.byType(Text).evaluate().map((element)=>(element.widget as Text).data).whereType<String>().join(' | ')}');}
   expect(finder,findsOneWidget);
  }
  await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:FoodWorkPage(api:api,thai:false)));
  await waitFor(find.text('No current offers'));debugPrint('BITPOS_OFFER077_READY');
  final decline=find.text('Decline this offer');await waitFor(decline);await tester.ensureVisible(decline);await tester.pump();debugPrint('BITPOS_OFFER077_VISIBLE');
  await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:3)));await tester.tap(decline);await tester.pumpAndSettle();
  final reason=find.text('Safety concern');await waitFor(reason);await tester.tap(reason);await tester.pump();
  await waitFor(find.text('No current offers'));expect(find.text('Accept this offer'),findsNothing);expect(await api.pendingFoodDispatch(),isNull);
  debugPrint('BITPOS_OFFER077_COMMITTED');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:3)));
  binding.reportData={'status':'PASS_AVD_ACTUAL_API_OFFER_REFUSAL','fixture':true,'physicalTesting':'deferred_by_user_2026-10-16','limits':['Mock secure storage holds only this synthetic session; HTTP/SSE/command/journal implementation is real','No assigned custody or financial effect claim']};
 });
}
