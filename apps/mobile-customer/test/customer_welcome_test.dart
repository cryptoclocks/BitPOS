import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/customer_welcome.dart';
void main(){
 testWidgets('welcome uses approved assets and explicit start on narrow large Thai phone',(tester)async{
  await tester.binding.setSurfaceSize(const Size(320,844));addTearDown(()=>tester.binding.setSurfaceSize(null));var started=0,language=0;
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:const TextScaler.linear(1.5)),child:CustomerWelcome(thai:true,onStart:()=>started++,onLanguage:()=>language++)))));await tester.pumpAndSettle();
  expect(find.text('มื้ออร่อย ในจังหวะของคุณ'),findsOneWidget);expect(find.text('สั่งจากร้านโปรด แล้วให้ BitPOS ดูแลทุกขั้นตอนจนถึงมือคุณ'),findsOneWidget);expect(started,0);
  await tester.tap(find.text('English'));expect(language,1);
  await tester.ensureVisible(find.byKey(const ValueKey('customer-welcome-start')));await tester.pump();
  await tester.tap(find.byKey(const ValueKey('customer-welcome-start')));expect(started,1);expect(tester.takeException(),isNull);
 });
 testWidgets('welcome keeps the approved phone art bounded on English desktop',(tester)async{
  await tester.binding.setSurfaceSize(const Size(1280,900));addTearDown(()=>tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(const MaterialApp(home:CustomerWelcome(thai:false,onStart:_noop,onLanguage:_noop)));await tester.pumpAndSettle();
  final artwork=tester.getRect(find.byKey(const ValueKey('customer-welcome-artwork')));
  final action=tester.getRect(find.byKey(const ValueKey('customer-welcome-start')));
  expect(artwork.width,472);expect(artwork.left,404);expect(action.width,472);expect(find.text('Good food, at your pace'),findsOneWidget);expect(tester.takeException(),isNull);
 });
}
void _noop(){}
