import 'package:flutter/material.dart';import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';import 'package:bitpos_customer/presentation/refund_obligation_card.dart';
void main(){for(final status in ['REQUESTED','CONFIRMED'])testWidgets('refund card does not infer transfer proof from status $status',(tester)async{
 await tester.binding.setSurfaceSize(const Size(320,900));addTearDown(()=>tester.binding.setSurfaceSize(null));
 final refund=MobileRefund(id:'10000000-0000-4000-8000-000000000001',version:'1',money:MobileMoney(currency:'USDG',decimals:6,amountMinor:'2700000'),status:status,cause:'ONLINE_ACCEPTANCE_TIMED_OUT');
 await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:const TextScaler.linear(1.5)),child:Scaffold(body:SingleChildScrollView(child:Padding(padding:const EdgeInsets.all(24),child:RefundObligationCard(refund:refund,thai:true))))))));
 expect(find.text('2.700000 USDG'),findsOneWidget);expect(find.text('ร้านไม่รับออเดอร์ภายในกำหนด'),findsOneWidget);
 expect(find.text('ยังไม่มีหลักฐานยืนยันการโอนคืนในข้อมูลนี้'),findsOneWidget);expect(find.text('โอนคืนแล้ว'),findsNothing);expect(tester.takeException(),isNull);
});}
