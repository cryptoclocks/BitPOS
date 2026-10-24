import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_customer/presentation/customer_welcome.dart';
void main(){testWidgets('welcome uses approved assets and explicit start on narrow large Thai phone',(tester)async{
 await tester.binding.setSurfaceSize(const Size(320,844));addTearDown(()=>tester.binding.setSurfaceSize(null));var started=0,language=0;
 await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:const TextScaler.linear(1.5)),child:CustomerWelcome(thai:true,onStart:()=>started++,onLanguage:()=>language++)))));await tester.pumpAndSettle();
 expect(find.text('มื้ออร่อย ในจังหวะของคุณ'),findsOneWidget);expect(started,0);
 await tester.tap(find.text('English'));expect(language,1);
 await tester.scrollUntilVisible(find.byKey(const ValueKey('customer-welcome-start')),200,scrollable:find.byType(Scrollable).first);
 await tester.tap(find.byKey(const ValueKey('customer-welcome-start')));expect(started,1);expect(tester.takeException(),isNull);
});}
