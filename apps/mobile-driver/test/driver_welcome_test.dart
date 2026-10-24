import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_driver/presentation/driver_welcome.dart';
void main(){testWidgets('rider welcome on narrow large Thai display labels artwork and requires start',(tester)async{
 await tester.binding.setSurfaceSize(const Size(320,844));addTearDown(()=>tester.binding.setSurfaceSize(null));var starts=0,languages=0;
 await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:const TextScaler.linear(1.5)),child:DriverWelcome(thai:true,onStart:()=>starts++,onLanguage:()=>languages++)))));await tester.pumpAndSettle();
 expect(find.text('แผนที่ตัวอย่าง'),findsOneWidget);expect(starts,0);
 await tester.tap(find.text('English'));expect(languages,1);
 final start=find.byKey(const ValueKey('driver-welcome-start'));await tester.scrollUntilVisible(start,200,scrollable:find.byType(Scrollable).first);await tester.ensureVisible(start);await tester.pumpAndSettle();await tester.tap(start);expect(starts,1);expect(tester.takeException(),isNull);
});}
