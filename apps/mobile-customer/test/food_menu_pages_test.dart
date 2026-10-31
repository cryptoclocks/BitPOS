import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/food_page.dart';
import 'food_history_test.dart' show id;
class MenuPagesApi extends MobileApi{
 MenuPagesApi({this.productCount=500,this.openNow}):super(base:Uri.parse('http://127.0.0.1/api/mobile/v1/'),fixture:true);
 final int productCount;
 final bool? openNow;
 late final branch=MobileBranch(id:id(1),merchantId:id(2),merchantName:'Fixture merchant',name:'ร้านทดสอบ',nameEn:'Fixture branch',addressLabel:'Local fixture',pickupEnabled:true,deliveryEnabled:false,version:1,openNow:openNow,nextOpenAt:openNow==false?'2026-11-02T01:00:00Z':null);
 bool failContinuation=true;
 @override Future<MobileFoodOrderRequest?> pendingFoodOrder() async=>null;
 @override Future<String?> activeFoodOrderId() async=>null;
 @override Future<MobileBranches> branches({String? cursor,String search='',String serving='all'}) async=>MobileBranches(branches:[branch],nextCursor:null);
 @override Future<MobileMenu> menu(String branchId,{String? cursor,String? menuVersion}) async{
  final start=cursor==null?0:int.parse(cursor.substring(24));
  if(start>0&&failContinuation){failContinuation=false;throw Exception('offline fixture');}
  if(start>0&&menuVersion!='fixture-version')throw StateError('Missing pinned version');
  final end=(start+30).clamp(0,productCount),money=MobileMoney(currency:'USD',decimals:2,amountMinor:'270');
  return MobileMenu(branch:branch,coverUrl:'',asOf:'2026-10-16T00:00:00Z',priceValidUntil:'2099-01-01T00:00:00Z',menuVersion:'fixture-version',priceVersion:id(3),pricingRevision:'1',nextCursor:end<productCount?id(end):null,products:List.generate(end-start,(offset){final n=start+offset+1;return MobileProduct(id:id(1000+n),name:'เมนู$n',nameEn:'Searchable food $n',category:'Fixture',description:'',imageUrl:'',story:MobileProductStory(story:'',storyEn:'',ingredients:'',ingredientsEn:'',benefits:'',benefitsEn:'',videoUrl:''),available:10,unitPrice:money,basePrice:money,options:MobileProductOptions(version:null,revision:'0',noteEnabled:true,groups:[]));}));
 }
}
void main(){
 testWidgets('closed branch menu shows shared closed state and keeps menu/cart usable',(tester) async{
  final api=MenuPagesApi(productCount:2,openNow:false);addTearDown(api.close);
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodPage(api:api,thai:true,onAuthenticationRequired:(){})))));
  await tester.pumpAndSettle();
  expect(find.byKey(const ValueKey('branch-closed-chip')),findsOneWidget);
  await tester.tap(find.text('ร้านทดสอบ'));await tester.pumpAndSettle();
  expect(find.byKey(const ValueKey('bitpos-state-closed')),findsOneWidget);
  expect(find.textContaining('ตะกร้าของคุณยังอยู่'),findsWidgets);
  expect(find.text('เมนู1'),findsOneWidget,reason:'closed does not hide the menu or clear the cart');
 });
 testWidgets('open or unknown-hours branch menu has no closed state',(tester) async{
  for(final open in [true,null]){
   final api=MenuPagesApi(productCount:1,openNow:open);addTearDown(api.close);
   await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodPage(api:api,thai:true,onAuthenticationRequired:(){})))));
   await tester.pumpAndSettle();await tester.tap(find.text('ร้านทดสอบ'));await tester.pumpAndSettle();
   expect(find.byKey(const ValueKey('bitpos-state-closed')),findsNothing);
  }
 });
 testWidgets('Thai menu no-match clears locally to loaded results',(tester) async{
  final api=MenuPagesApi(productCount:2);addTearDown(api.close);
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodPage(api:api,thai:true,onAuthenticationRequired:(){})))));
  await tester.pumpAndSettle();
  await tester.tap(find.text('ร้านทดสอบ'));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField),'ไม่ตรงกับเมนู');await tester.pumpAndSettle();
  expect(find.text('ไม่พบเมนูที่ตรงกับการค้นหา ล้างการค้นหาเพื่อดูเมนูทั้งหมด'),findsOneWidget);
  expect(find.text('ยังไม่มีเมนู'),findsNothing);
  await tester.ensureVisible(find.byTooltip('ล้างการค้นหาเมนู'));
  await tester.tap(find.byTooltip('ล้างการค้นหาเมนู'));await tester.pumpAndSettle();
  expect(find.text('เมนู1'),findsOneWidget);
  expect(find.text('เมนู2'),findsOneWidget);
  expect(find.byTooltip('ล้างการค้นหาเมนู'),findsNothing);
 });
 testWidgets('authoritative empty menu is not a search no-match',(tester) async{
  final api=MenuPagesApi(productCount:0);addTearDown(api.close);
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodPage(api:api,thai:false,onAuthenticationRequired:(){})))));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Fixture branch'));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField),'missing');await tester.pumpAndSettle();
  expect(find.text('No menu items available'),findsOneWidget);
  expect(find.text('No matching menu items. Clear search to see all menu items.'),findsNothing);
  await tester.ensureVisible(find.byTooltip('Clear menu search'));
  await tester.tap(find.byTooltip('Clear menu search'));await tester.pumpAndSettle();
  expect(find.text('No menu items available'),findsOneWidget);
 });
 testWidgets('failed continuation exposes no partial menu and retry searches product500',(tester) async{
  final api=MenuPagesApi();addTearDown(api.close);
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodPage(api:api,thai:false,onAuthenticationRequired:(){})))));await tester.pumpAndSettle();
  await tester.tap(find.text('Fixture branch'));await tester.pumpAndSettle();
  expect(find.text('Searchable food 1'),findsNothing);expect(find.text('Fixture branch'),findsOneWidget);
  expect(find.text('Search menu'),findsNothing);
  expect(find.byTooltip('Clear menu search'),findsNothing);
  expect(find.text('No menu items available'),findsNothing);
  expect(find.text('No matching menu items. Clear search to see all menu items.'),findsNothing);
  await tester.tap(find.text('Fixture branch'));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField),'food 500');await tester.pumpAndSettle();
  expect(find.text('Searchable food 500'),findsOneWidget);expect(find.text('Searchable food 1'),findsNothing);
  await tester.ensureVisible(find.text('Configure / add'));
  await tester.tap(find.text('Configure / add'));
  await tester.pump();await tester.pump(const Duration(milliseconds:400));
  await tester.enterText(find.byType(TextField).last,'Keep this note');
  await tester.ensureVisible(find.text('Add to cart'));
  await tester.tap(find.text('Add to cart'));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField),'no such dish');await tester.pumpAndSettle();
  expect(find.text('No matching menu items. Clear search to see all menu items.'),findsOneWidget);
  expect(find.text('No menu items available'),findsNothing);
  expect(find.text('Review cart · 1'),findsOneWidget);
  await tester.ensureVisible(find.byTooltip('Clear menu search'));
  await tester.tap(find.byTooltip('Clear menu search'));await tester.pumpAndSettle();
  expect(find.text('Searchable food 1'),findsOneWidget);
  expect(find.text('Searchable food 500'),findsWidgets);
  expect(find.text('No matching menu items. Clear search to see all menu items.'),findsNothing);
  expect(find.text('Review cart · 1'),findsOneWidget);
  expect(find.textContaining('Keep this note'),findsOneWidget);
  await tester.ensureVisible(find.text('Merchants'));await tester.tap(find.text('Merchants'));await tester.pumpAndSettle();
  await tester.tap(find.text('Fixture branch'));await tester.pumpAndSettle();
  expect(tester.widget<TextField>(find.byType(TextField)).controller!.text,'');expect(find.text('Searchable food 1'),findsOneWidget);
 });
}
