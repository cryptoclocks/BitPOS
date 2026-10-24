import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:bitpos_customer/product_options_sheet.dart';
import '../test/product_options_test.dart' as fixture;
void main(){IntegrationTestWidgetsFlutterBinding.ensureInitialized();testWidgets('U10 native header hero action calibration with original fixture',(tester)async{
 await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:Builder(builder:(context)=>Scaffold(body:TextButton(onPressed:()=>showModalBottomSheet<void>(context:context,isScrollControlled:true,useSafeArea:true,builder:(_)=>ProductOptionsSheet(product:fixture.product(),options:fixture.options(),lineId:fixture.id(6),thai:false,maximumQuantity:3)),child:const Text('Open calibration'))))));
 await tester.tap(find.text('Open calibration'));await tester.pumpAndSettle();
 Map<String,double> rect(Finder f){final r=tester.getRect(f);return {'left':r.left,'top':r.top,'width':r.width,'height':r.height};}
 debugPrint('BITPOS_U10_GEOMETRY ${jsonEncode({'back':rect(find.byKey(const ValueKey('product-detail-back'))),'hero':rect(find.byKey(const ValueKey('product-detail-hero'))),'submit':rect(find.byKey(const ValueKey('product-detail-submit'))),'viewportWidth':tester.view.physicalSize.width/tester.view.devicePixelRatio,'viewportHeight':tester.view.physicalSize.height/tester.view.devicePixelRatio,'dpr':tester.view.devicePixelRatio})}');
 expect(tester.getRect(find.byKey(const ValueKey('product-detail-hero'))).height,closeTo(238,0.01));
 expect(tester.getRect(find.byKey(const ValueKey('product-detail-submit'))).left,24);
 debugPrint('BITPOS_U10_CAPTURE_READY');await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:3)));
 await tester.ensureVisible(find.byTooltip('Increase Oat'));await tester.tap(find.byTooltip('Increase Oat'));await tester.pumpAndSettle();
 await tester.ensureVisible(find.byKey(const ValueKey('product-detail-submit')));await tester.tap(find.byKey(const ValueKey('product-detail-submit')));await tester.pumpAndSettle();expect(find.byType(ProductOptionsSheet),findsNothing);
});}
