import 'dart:async';
import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';import 'package:mobile_shared/mobile_v1.generated.dart';import 'package:mobile_shared/support_mutation.dart';
import 'package:bitpos_customer/help_page.dart';import 'package:bitpos_customer/support_page.dart';
class HelpFixtureApi extends MobileApi{
 HelpFixtureApi():super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 final result=Completer<MobileSupportCases>();int calls=0;SupportMutation? submitted;
 @override Future<void> submitSupportMutation(SupportMutation mutation)async{submitted=mutation;}
 @override Future<SupportMutation?> pendingSupportMutation()async=>null;
 @override Future<MobileSupportCases> supportCases({String? cursor}){calls++;return result.future;}
}
void main(){
 testWidgets('order support form submits the exact owned merchant and order context',(tester)async{
  final api=HelpFixtureApi();addTearDown(api.close);api.result.complete(MobileSupportCases(items:[],nextCursor:null));
  final order=MobileSupportOrder(merchantId:'00000000-0000-4000-8000-000000000010',orderId:'00000000-0000-4000-8000-000000000011');
  await tester.pumpWidget(MaterialApp(home:SupportPage(api:api,owner:null,thai:false,initialSubject:'Order enquiry',order:order,onAuthenticationRequired:(){})));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField).last,'Missing item');await tester.ensureVisible(find.text('Send request / message'));await tester.tap(find.text('Send request / message'));await tester.pumpAndSettle();
  expect(api.submitted,isA<CreateSupportMutation>());final sent=api.submitted as CreateSupportMutation;expect(sent.command.order!.toJson(),order.toJson());expect(sent.command.message,'Missing item');expect(sent.command.subject,'Order enquiry');expect(tester.takeException(),isNull);
 });
 testWidgets('help category opens real support form and owner loss removes both nested private routes',(tester)async{
  final api=HelpFixtureApi();addTearDown(api.close);final owner=ValueNotifier(true);addTearDown(owner.dispose);
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()=>Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>HelpPage(api:api,owner:owner,thai:false,onAuthenticationRequired:(){}))),child:const Text('Open help'))))));
  await tester.tap(find.text('Open help'));await tester.pumpAndSettle();expect(find.text('How can we help?'),findsOneWidget);expect(api.calls,0);
  await tester.tap(find.text('Payments'));await tester.pump();await tester.pump(const Duration(milliseconds:400));expect(find.byType(SupportPage),findsOneWidget);expect(api.calls,1);expect(tester.widget<TextField>(find.byType(TextField).first).controller!.text,'Payments');
  owner.value=false;await tester.pump();await tester.pump(const Duration(milliseconds:400));api.result.complete(MobileSupportCases(items:[],nextCursor:null));await tester.pump();
  expect(find.byType(SupportPage),findsNothing);expect(find.byType(HelpPage),findsNothing);expect(find.text('Open help'),findsOneWidget);expect(tester.takeException(),isNull);
 });
 testWidgets('help invalidated before mounting cannot open a private support route',(tester)async{
  final api=HelpFixtureApi();addTearDown(api.close);final owner=ValueNotifier(true);addTearDown(owner.dispose);
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:(){Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>HelpPage(api:api,owner:owner,thai:true,onAuthenticationRequired:(){})));owner.value=false;},child:const Text('Open help'))))));
  await tester.tap(find.text('Open help'));await tester.pump();await tester.pump(const Duration(milliseconds:400));expect(find.byType(HelpPage),findsNothing);expect(api.calls,0);expect(tester.takeException(),isNull);
 });
}
