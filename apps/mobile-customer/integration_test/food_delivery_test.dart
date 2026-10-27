import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:bitpos_customer/main.dart' as app;
import 'package:bitpos_customer/order_history_sheet.dart';
import 'package:bitpos_customer/food_delivery_panel.dart';

// Authorized local AVD fixture only. No API substitution or invented proof.
void main(){
 final binding=IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('owned customer delivery lifecycle uses actual local authority',(tester) async {
  const orderId=String.fromEnvironment('BITPOS_TEST_ORDER_ID'),stage=String.fromEnvironment('BITPOS_TEST_CUSTOMER_STAGE',defaultValue:'ISSUE');
  if(!const bool.fromEnvironment('BITPOS_FIXTURE')||!RegExp(r'^[0-9a-f-]{36}$').hasMatch(orderId)||!['ISSUE','VERIFY_DELIVERED'].contains(stage))throw StateError('Local fixture order and supported stage required');
  Future<void> waitFor(Finder finder) async {
   final deadline=DateTime.now().add(const Duration(seconds:45));
   while(finder.evaluate().isEmpty&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}
   expect(finder,findsOneWidget);
  }
  Future<void> idle() async {
   final deadline=DateTime.now().add(const Duration(seconds:45));
   while(find.byType(LinearProgressIndicator).evaluate().isNotEmpty&&DateTime.now().isBefore(deadline)){await tester.pump(const Duration(milliseconds:200));}
   expect(find.byType(LinearProgressIndicator),findsNothing);
  }
  Future<void> english() async {
   if(find.text('English').evaluate().isNotEmpty){await tester.tap(find.text('English'));await tester.pump();}
  }
  Future<void> button(String label) async {
   final finder=find.widgetWithText(FilledButton,label);await waitFor(finder);
   await tester.ensureVisible(finder);await tester.pump();
   expect(tester.widget<FilledButton>(finder).onPressed,isNotNull);
   await tester.tap(finder);await tester.pump();await idle();
  }
  app.main();await tester.pump();await idle();await english();
  if(find.text('Send sign-in code').evaluate().isNotEmpty){
   await tester.enterText(find.byWidgetPredicate((w)=>w is TextField&&w.decoration?.labelText=='Phone with country code'),'+66900000001');
   await button('Send sign-in code');
   await tester.enterText(find.byWidgetPredicate((w)=>w is TextField&&w.decoration?.labelText=='Six-digit code'),'123456');
   await button('Verify code');await english();await idle();
  }
  final history=find.byTooltip('My orders');await waitFor(history);await tester.ensureVisible(history);await tester.tap(history);await tester.pump();
  final row=find.descendant(of:find.byType(OrderHistorySheet),matching:find.textContaining('#${orderId.substring(0,8)}'));
  await waitFor(row);await tester.ensureVisible(row);await tester.tap(row);await tester.pump();await idle();
  await button('Track delivery');await waitFor(find.byType(FoodDeliveryPage));await idle();
  if(stage=='VERIFY_DELIVERED'){
   await waitFor(find.text('Shipment: DELIVERED'));
   expect(find.descendant(of:find.byType(FoodDeliveryPage),matching:find.byType(SelectableText)),findsNothing);
   await tester.tap(find.descendant(of:find.byType(FoodDeliveryPage),matching:find.byIcon(Icons.arrow_back)));await tester.pumpAndSettle();
   expect(find.byType(FoodDeliveryPage),findsNothing);
   binding.reportData={'status':'PASS','stage':'customer_delivered_snapshot','orderId':orderId,'fixture':true,'physicalTesting':'deferred_by_user_2026-10-16','limits':['Actual local API restart/snapshot recovery and normal private-route exit','No physical delivery or payout claim']};
   return;
  }
  await button('Issue delivery proof');
  final capability=find.byWidgetPredicate((w)=>w is SelectableText&&w.semanticsLabel=='Delivery proof secret');await waitFor(capability);
  final secret=tester.widget<SelectableText>(capability).data;
  if(secret==null||secret.length!=43)throw StateError('Expected private fixture capability unavailable');
  // App-private export, retrieved via adb run-as to private host config; never logs.
  final output=File('${Directory.systemTemp.path}/bitpos-fixture-delivery-proof.json');
  await output.writeAsString(jsonEncode({'BITPOS_TEST_DELIVERY_SECRET':secret}),flush:true);
  binding.reportData={'status':'PASS','stage':'customer_delivery_proof','orderId':orderId,'fixture':true,'capabilityExport':'app-private cache only','physicalTesting':'deferred_by_user_2026-10-16','limits':['Synthetic OTP and local API; no real message/payment/delivery','Persisted counterpart and driver delivery verified separately']};
 });
}
