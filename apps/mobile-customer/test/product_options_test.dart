import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/product_options_sheet.dart';

String id(int n)=>'aa000000-0000-4000-8000-${n.toString().padLeft(12,'0')}';
MobileProduct product()=>MobileProduct(id:id(1),name:'กาแฟ',nameEn:'Coffee',category:'',description:'',imageUrl:'',available:3,unitPrice:MobileMoney(currency:'USD',decimals:2,amountMinor:'270'),basePrice:MobileMoney(currency:'USD',decimals:2,amountMinor:'270'),options:options());
MobileProductOptions options()=>MobileProductOptions(version:id(2),revision:'1',noteEnabled:true,groups:[MobileOptionGroup(id:id(3),name:'นม',nameEn:'Milk',enabled:true,minSelections:1,maxSelections:1,choices:[MobileOptionChoice(id:id(4),name:'โอ๊ต',nameEn:'Oat',enabled:true,maxQty:1,priceDelta:MobileMoney(currency:'USD',decimals:2,amountMinor:'35')),MobileOptionChoice(id:id(5),name:'ถั่ว',nameEn:'Soy',enabled:true,maxQty:1,priceDelta:MobileMoney(currency:'USD',decimals:2,amountMinor:'0'))])]);
void main(){
 testWidgets('required selection blocks commit and latest exclusive choice replaces its peer',(tester) async {
  MobileConfiguredCartItem? result;
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()async{result=await showModalBottomSheet<MobileConfiguredCartItem>(context:context,isScrollControlled:true,builder:(_)=>ProductOptionsSheet(product:product(),options:options(),lineId:id(6),thai:false,maximumQuantity:3));},child:const Text('Open'))))));
  await tester.tap(find.text('Open'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Add to cart'));await tester.tap(find.text('Add to cart'));await tester.pumpAndSettle();
  expect(result,isNull);expect(find.byType(ProductOptionsSheet),findsOneWidget);
  await tester.ensureVisible(find.byTooltip('Increase Oat'));await tester.tap(find.byTooltip('Increase Oat'));await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('Increase Soy'));await tester.pumpAndSettle();
  expect(find.byTooltip('Increase Oat'),findsOneWidget);
  expect(find.byTooltip('Decrease Soy'),findsOneWidget);
  await tester.ensureVisible(find.byTooltip('Increase product quantity'));await tester.tap(find.byTooltip('Increase product quantity'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Add to cart'));await tester.tap(find.text('Add to cart'));await tester.pumpAndSettle();
  expect(result!.qty,2);expect(result!.lineId,id(6));expect(result!.selections.single.choiceId,id(5));expect(result!.selections.single.qty,1);
 });
 testWidgets('editing preserves line identity and a stale option version requires reselection',(tester) async {
  MobileConfiguredCartItem? result;
  final initial=MobileConfiguredCartItem(lineId:id(7),productId:id(1),qty:2,optionVersion:id(99),selections:[MobileOptionSelection(groupId:id(3),choiceId:id(4),qty:1)],allergyNote:'No dairy');
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()async{result=await showModalBottomSheet<MobileConfiguredCartItem>(context:context,isScrollControlled:true,builder:(_)=>ProductOptionsSheet(product:product(),options:options(),lineId:id(8),thai:false,maximumQuantity:3,initial:initial));},child:const Text('Open'))))));
  await tester.tap(find.text('Open'));await tester.pumpAndSettle();await tester.ensureVisible(find.text('Save item'));await tester.tap(find.text('Save item'));await tester.pumpAndSettle();expect(result,isNull);
  await tester.ensureVisible(find.byTooltip('Increase Soy'));await tester.tap(find.byTooltip('Increase Soy'));await tester.pumpAndSettle();await tester.ensureVisible(find.text('Save item'));await tester.tap(find.text('Save item'));await tester.pumpAndSettle();
  expect(result!.lineId,id(7));expect(result!.optionVersion,id(2));expect(result!.allergyNote,'No dairy');expect(result!.selections.single.choiceId,id(5));expect(result!.qty,2);
 });
 testWidgets('optional exclusive choice can be deselected at narrow enlarged text',(tester) async {
  await tester.binding.setSurfaceSize(const Size(320,844));
  addTearDown(()=>tester.binding.setSurfaceSize(null));
  final group=options().groups.single;
  final optional=MobileProductOptions(version:id(2),revision:'1',noteEnabled:false,groups:[
   MobileOptionGroup(id:group.id,name:group.name,nameEn:group.nameEn,enabled:true,minSelections:0,maxSelections:1,choices:group.choices),
  ]);
  MobileConfiguredCartItem? result;
  await tester.pumpWidget(MaterialApp(builder:(context,child)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:TextScaler.linear(1.5)),child:child!),home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()async{
   result=await showModalBottomSheet<MobileConfiguredCartItem>(context:context,isScrollControlled:true,builder:(_)=>ProductOptionsSheet(product:product(),options:optional,lineId:id(6),thai:false,maximumQuantity:3));
  },child:const Text('Open'))))));
  await tester.tap(find.text('Open'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.byTooltip('Increase Oat'));await tester.tap(find.byTooltip('Increase Oat'));await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('Decrease Oat'));await tester.pumpAndSettle();
  expect(find.byTooltip('Increase Oat'),findsOneWidget);
  await tester.ensureVisible(find.text('Add to cart'));await tester.tap(find.text('Add to cart'));await tester.pumpAndSettle();
  expect(result!.selections,isEmpty);
  expect(tester.takeException(),isNull);
 });
 testWidgets('binary choices and repeatable steppers share the group quantity limit',(tester) async {
  final group=options().groups.single;
  final mixed=MobileProductOptions(version:id(2),revision:'1',noteEnabled:false,groups:[
   MobileOptionGroup(id:group.id,name:group.name,nameEn:group.nameEn,enabled:true,minSelections:0,maxSelections:2,choices:[
    ...group.choices,
    MobileOptionChoice(id:id(9),name:'เพิ่ม',nameEn:'Extra',enabled:true,maxQty:2,priceDelta:MobileMoney(currency:'USD',decimals:2,amountMinor:'10')),
   ]),
  ]);
  MobileConfiguredCartItem? result;
  await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()async{
   result=await showModalBottomSheet<MobileConfiguredCartItem>(context:context,isScrollControlled:true,builder:(_)=>ProductOptionsSheet(product:product(),options:mixed,lineId:id(6),thai:false,maximumQuantity:3));
  },child:const Text('Open'))))));
  await tester.tap(find.text('Open'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.byTooltip('Increase Extra'));await tester.tap(find.byTooltip('Increase Extra'));await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('Increase Extra'));await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('Increase Extra'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.byTooltip('Increase Oat'));
  await tester.tap(find.byTooltip('Increase Oat'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.byTooltip('Decrease Extra'));await tester.tap(find.byTooltip('Decrease Extra'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.byTooltip('Increase Oat'));await tester.tap(find.byTooltip('Increase Oat'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.byTooltip('Increase Soy'));await tester.tap(find.byTooltip('Increase Soy'));await tester.pumpAndSettle();
  await tester.tap(find.byTooltip('Decrease Oat'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.byTooltip('Increase Soy'));await tester.tap(find.byTooltip('Increase Soy'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Add to cart'));await tester.tap(find.text('Add to cart'));await tester.pumpAndSettle();
  expect(result!.selections.map((s)=>s.choiceId),unorderedEquals([id(5),id(9)]));
  expect(result!.selections.map((s)=>s.qty),everyElement(1));
 });
}
