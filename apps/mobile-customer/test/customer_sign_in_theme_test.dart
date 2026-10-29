import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';import 'package:bitpos_customer/presentation/customer_sign_in.dart';
void main(){testWidgets('dark sign-in uses readable themed heading and field surface',(tester)async{
 final theme=BitPosTheme.dark();
 await tester.pumpWidget(MaterialApp(theme:theme,home:const Scaffold(body:CustomerSignInControls(child:Column(children:[CustomerSignInHeading(thai:false,sent:false,phone:''),TextField()])))));
 final heading=tester.widget<Text>(find.text('Welcome back'));expect(heading.style!.color,theme.colorScheme.onSurface);
 final inputTheme=Theme.of(tester.element(find.byType(TextField))).inputDecorationTheme;expect(inputTheme.fillColor,theme.colorScheme.surface);expect(inputTheme.fillColor,isNot(Colors.white));expect(tester.takeException(),isNull);
});}
