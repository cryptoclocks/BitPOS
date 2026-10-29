import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:bitpos_driver/presentation/driver_account_actions.dart';
void main(){
 testWidgets('account shortcuts open controls only after tap and tolerate Thai text scaling',(tester)async{
  tester.view.physicalSize=const Size(390,844);tester.view.devicePixelRatio=1;addTearDown(tester.view.reset);int location=0,earnings=0;
  await tester.pumpWidget(MaterialApp(home:MediaQuery(data:const MediaQueryData(textScaler:TextScaler.linear(1.5)),child:Scaffold(body:SingleChildScrollView(child:DriverAccountActions(thai:true,onLocation:()=>location++,onEarnings:()=>earnings++))))));
  expect(location,0);expect(earnings,0);await tester.tap(find.text('การรับตำแหน่ง'));expect(location,1);expect(earnings,0);await tester.tap(find.text('รายได้และบัญชีรับเงิน'));expect(earnings,1);expect(tester.takeException(),isNull);
 });
 testWidgets('disabled shortcuts do not invoke destination',(tester)async{
  await tester.pumpWidget(const MaterialApp(home:Scaffold(body:DriverAccountActions(thai:false))));
  await tester.tap(find.text('Location sharing'));expect(tester.takeException(),isNull);
 });
}
