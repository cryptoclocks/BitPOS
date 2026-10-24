import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:bitpos_driver/main.dart' as app;

// Run only on the authorized AVD against the local synthetic provider fixture.
// The code comes from actual merchant UI issuance, never a fabricated success.
void main(){
 final binding=IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('driver custody lifecycle uses actual local authority',(tester) async {
  const stage=String.fromEnvironment('BITPOS_TEST_CUSTODY_STAGE',defaultValue:'PICKUP');
  const secret=stage=='DELIVERY'?String.fromEnvironment('BITPOS_TEST_DELIVERY_SECRET'):String.fromEnvironment('BITPOS_TEST_PICKUP_SECRET');
  if(!const bool.fromEnvironment('BITPOS_FIXTURE')||!['PICKUP','VERIFY_PICKUP','ARRIVAL','DELIVERY'].contains(stage)||(['PICKUP','DELIVERY'].contains(stage)&&secret.isEmpty))throw StateError('Local fixture and supported custody stage required');
  Future<void> waitFor(Finder finder) async {
   final deadline=DateTime.now().add(const Duration(seconds:45));
   while(finder.evaluate().isEmpty&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}
   expect(finder,findsOneWidget);
  }
  Future<void> enabled(Finder finder) async {
   final deadline=DateTime.now().add(const Duration(seconds:45));
   while((finder.evaluate().isEmpty||tester.widget<FilledButton>(finder).onPressed==null)&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}
   expect(finder,findsOneWidget);expect(tester.widget<FilledButton>(finder).onPressed,isNotNull);
  }
  Future<void> button(String label) async {
   final finder=find.widgetWithText(FilledButton,label);await enabled(finder);
   await tester.ensureVisible(finder);await tester.pump();await enabled(finder);await tester.tap(finder);await tester.pump();
  }
  app.main();await waitFor(find.text('English'));await tester.tap(find.text('English'));await tester.pump();
  Future<void> idle() async {
   final deadline=DateTime.now().add(const Duration(seconds:45));
   while(find.byType(LinearProgressIndicator).evaluate().isNotEmpty&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}
   expect(find.byType(LinearProgressIndicator),findsNothing);
  }
  await idle();
  if(find.text('Request OTP').evaluate().isNotEmpty){
   await tester.enterText(find.byWidgetPredicate((w)=>w is TextField&&w.decoration?.labelText=='Phone +66…'),'+66900000002');
   await button('Request OTP');await idle();
   await tester.enterText(find.byWidgetPredicate((w)=>w is TextField&&w.decoration?.labelText=='OTP code'),'123456');
   await button('Verify OTP');await idle();
  }
  await button('Open food deliveries');
  if(stage=='VERIFY_PICKUP'){
   final collected=find.text('Food collected — travel to customer');await waitFor(collected);await tester.ensureVisible(collected);await tester.pump();
   binding.reportData={'status':'PASS','stage':'visible_persisted_pickup','fixture':true,'physicalTesting':'deferred_by_user_2026-10-16','limits':['Read-only UI verification of prior actual custody submission','Persisted counterpart verified separately']};
   return;
  }
  if(stage=='ARRIVAL'){
   await waitFor(find.text('Food collected — travel to customer'));
   await tester.scrollUntilVisible(find.widgetWithText(FilledButton,'Arrived at destination'),300,scrollable:find.byType(Scrollable).last);
   await button('Arrived at destination');await tester.drag(find.byType(ListView).last,const Offset(0,1800));await tester.pump();
   await waitFor(find.text('At destination — customer proof required'));
   binding.reportData={'status':'PASS','stage':'destination_arrival','fixture':true,'physicalTesting':'deferred_by_user_2026-10-16','limits':['Synthetic destination and AVD interaction, not physical arrival','Persisted counterpart verified separately']};
   return;
  }
  await waitFor(find.text(stage=='DELIVERY'?'At destination — customer proof required':'At store — pickup proof required'));
  final custody=find.byKey(ValueKey('food-custody-${stage=='DELIVERY'?'DELIVERY':'PICKUP'}'));await waitFor(custody);await tester.ensureVisible(custody);await tester.pump();await enabled(custody);await tester.tap(custody);await tester.pump();await waitFor(find.text('Food custody proof'));
  await tester.enterText(find.descendant(of:find.byType(AlertDialog),matching:find.byType(TextField)),secret);await button('Confirm');
  await tester.drag(find.byType(ListView).last,const Offset(0,1800));await tester.pump();
  await waitFor(stage=='DELIVERY'?find.byKey(const ValueKey('food-delivery-confirmed')):find.text('Food collected — travel to customer'));
  expect(find.text('Food custody proof'),findsNothing);
  binding.reportData={'status':'PASS','stage':stage.toLowerCase(),'fixture':true,'physicalTesting':'deferred_by_user_2026-10-16','limits':['Flutter integration text input; not a physical keyboard/camera/field proof','Persisted counterpart verified separately']};
 });
}
