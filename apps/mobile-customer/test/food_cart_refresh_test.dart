import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:bitpos_customer/food_page.dart';
import 'food_menu_pages_test.dart' show MenuPagesApi;
import 'product_options_test.dart' as options;
class CartRefreshApi extends MenuPagesApi{
 bool updated=false;final quotes=<MobileFoodQuoteRequest>[];
 @override Future<MobileMenu> menu(String branchId,{String? cursor,String? menuVersion}) async{
  final base=await super.menu(branchId),json=base.toJson(),product=options.product().toJson();
  if(updated)(product['options'] as Map)['version']=options.id(99);
  json['products']=[product];json['nextCursor']=null;return MobileMenu.fromJson(json);
 }
 @override Future<MobileFoodQuote> quoteFood(MobileFoodQuoteRequest request) async{quotes.add(request);throw const MobileApiException('QUOTE_CHANGED',409);}
}
void main(){
 testWidgets('stale cart refresh preserves identity quantity note and explicitly reselects options',(tester) async{
  final api=CartRefreshApi();addTearDown(api.close);
  await tester.pumpWidget(MaterialApp(home:Scaffold(body:SingleChildScrollView(child:FoodPage(api:api,thai:false,onAuthenticationRequired:(){})))));await tester.pumpAndSettle();
  await tester.tap(find.text('Fixture branch'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Configure / add'));await tester.tap(find.text('Configure / add'));await tester.pump();await tester.pump(const Duration(milliseconds:400));
  await tester.ensureVisible(find.byTooltip('Increase Oat'));await tester.tap(find.byTooltip('Increase Oat'));
  await tester.ensureVisible(find.byTooltip('Increase product quantity'));await tester.tap(find.byTooltip('Increase product quantity'));
  await tester.enterText(find.byType(TextField).last,'No dairy');
  await tester.ensureVisible(find.text('Add to cart'));await tester.tap(find.text('Add to cart'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Review cart · 2'));await tester.tap(find.text('Review cart · 2'));await tester.pumpAndSettle();
  final original=api.quotes.single.items.single;api.updated=true;
  await tester.ensureVisible(find.text('Refresh menu; keep cart'));await tester.tap(find.text('Refresh menu; keep cart'));await tester.pumpAndSettle();
  expect(find.text('Options changed. Review this item.'),findsOneWidget);
  await tester.ensureVisible(find.text('Edit item'));await tester.tap(find.text('Edit item'));await tester.pump();await tester.pump(const Duration(milliseconds:400));
  expect((tester.widget<TextField>(find.byType(TextField).last)).controller!.text,'No dairy');
  await tester.ensureVisible(find.text('Save item'));await tester.tap(find.text('Save item'));await tester.pump();expect(find.text('Choose 1–1 Milk per item.'),findsOneWidget);
  await tester.ensureVisible(find.byTooltip('Increase Soy'));await tester.tap(find.byTooltip('Increase Soy'));await tester.ensureVisible(find.text('Save item'));await tester.tap(find.text('Save item'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Review cart · 2'));await tester.tap(find.text('Review cart · 2'));await tester.pumpAndSettle();
  final refreshed=api.quotes.last.items.single;expect(refreshed.lineId,original.lineId);expect(refreshed.qty,2);expect(refreshed.allergyNote,'No dairy');expect(refreshed.optionVersion,options.id(99));expect(refreshed.selections.single.choiceId,options.id(5));
 });
}
