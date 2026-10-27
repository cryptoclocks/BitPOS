import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;
import 'dart:typed_data';
import 'package:flutter/rendering.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/food_navigation_map.dart';
import 'food_navigation_map_test.dart' as fixture;
FoodNavigationSnapshot configured({int metres=500})=>FoodNavigationSnapshot.fromJson({...fixture.snapshot(fixture.first,metres:metres).toJson(),'tilesAvailable':true,'tileAttribution':'Synthetic original unit grid','tileFixture':true});
class TileApi extends fixture.NavigationApi{
 TileApi(this.tile){current=configured();}
 final FoodNavigationTile tile;Completer<FoodNavigationTile>? gate;
 @override Future<FoodNavigationTile> foodNavigationTile({String? orderId,required String assignmentId,required String generation,required String leaseGeneration,required int z,required int x,required int y})=>gate?.future??Future.value(tile);
}
Widget surface(TileApi api,{String revision='1',double width=400})=>MaterialApp(home:Scaffold(body:SingleChildScrollView(child:Align(alignment:Alignment.topLeft,child:SizedBox(width:width,child:RepaintBoundary(key:const ValueKey('navigation-pixels'),child:FoodNavigationMap(api:api,assignmentId:fixture.first,generation:'1',leaseGeneration:'1',revision:revision,thai:false)))))));
void main(){
 TestWidgetsFlutterBinding.ensureInitialized();late FoodNavigationTile tile;
 setUpAll(() async{final recorder=ui.PictureRecorder();Canvas(recorder).drawColor(Colors.purple.shade50,BlendMode.src);final picture=recorder.endRecording(),image=await picture.toImage(256,256),bytes=await image.toByteData(format:ui.ImageByteFormat.png);tile=FoodNavigationTile(pngBase64:base64Encode(bytes!.buffer.asUint8List()),fixture:true,attribution:'Synthetic original unit grid');image.dispose();picture.dispose();});

 testWidgets('revoked tile response clears map and late sibling tiles cannot restore it',(tester) async {
  final api=TileApi(tile),gate=Completer<FoodNavigationTile>();api.gate=gate;addTearDown(api.close);
  await tester.pumpWidget(surface(api));await tester.pump();
  expect(find.textContaining('0.5 km'),findsOneWidget);
  gate.completeError(const MobileApiException('ASSIGNMENT_CHANGED',409));
  await tester.pumpAndSettle();
  expect(find.byType(Image),findsNothing);expect(find.byType(InteractiveViewer),findsNothing);
  expect(find.textContaining('0.5 km'),findsNothing);
  expect(find.textContaining('current tracking unconfirmed'),findsOneWidget);
  api.gate=null;
  await tester.tap(find.byTooltip('Refresh route'));await tester.pumpAndSettle();
  expect(find.byType(Image),findsNWidgets(9));expect(find.textContaining('0.5 km'),findsOneWidget);
  expect(tester.takeException(),isNull);await tester.pumpWidget(const MaterialApp());
 });
 testWidgets('slow tile rows complete despite newer input and unchanged heartbeat rebuilds',(tester) async{
  final api=TileApi(tile),gate=Completer<FoodNavigationTile>();api.gate=gate;addTearDown(api.close);await tester.pumpWidget(surface(api));await tester.pump();expect(find.textContaining('0.5 km'),findsOneWidget);
  for(var input=2;input<=5;input++){await tester.pump(const Duration(seconds:3));await tester.pumpWidget(surface(api,revision:'$input'));await tester.pump();expect(find.textContaining('0.5 km'),findsOneWidget);}
  gate.complete(tile);await tester.pumpAndSettle();expect(find.byType(Image),findsNWidgets(9));expect(find.byType(LinearProgressIndicator),findsNothing);expect(tester.takeException(),isNull);
 });
 testWidgets('routine route refresh retains tiles and pan; resize preserves relative camera center',(tester) async{
  final api=TileApi(tile);addTearDown(api.close);await tester.pumpWidget(surface(api));await tester.pumpAndSettle();
  await tester.drag(find.byType(InteractiveViewer),const Offset(30,0));await tester.pumpAndSettle();final marker=find.byIcon(Icons.delivery_dining),before=tester.getCenter(marker);
  final held=Completer<FoodNavigationSnapshot>();api.held[fixture.first]=held;await tester.pumpWidget(surface(api,revision:'2'));await tester.pump();
  expect(find.byType(Image),findsNWidgets(9));expect(tester.getCenter(marker).dx,closeTo(before.dx,.1));expect(find.textContaining('0.5 km'),findsOneWidget);
  held.complete(configured(metres:200));await tester.pumpAndSettle();expect(find.textContaining('0.2 km'),findsOneWidget);expect(tester.getCenter(marker).dx,closeTo(before.dx,.1));
  final viewer=find.byType(InteractiveViewer);
  Offset focus()=>tester.widget<InteractiveViewer>(viewer).transformationController!.toScene(tester.getSize(viewer).center(Offset.zero));
  final beforeResize=focus();
  await tester.pumpWidget(surface(api,revision:'2',width:600));await tester.pumpAndSettle();
  expect((focus()-beforeResize).distance,lessThan(.1));expect(tester.takeException(),isNull);
 });
 for(final direction in [1,-1]){
  testWidgets('dateline direction $direction keeps destination and painted route in the nearest world copy after zoom',(tester) async{
   final api=TileApi(tile);addTearDown(api.close);final json=configured().toJson(),assignment=Map<String,dynamic>.from(json['assignment'] as Map),location=Map<String,dynamic>.from(assignment['location'] as Map),route=Map<String,dynamic>.from(json['route'] as Map);
   location.addAll({'latitudeE7':0,'longitudeE7':direction*1799990000});assignment.addAll({'location':location,'targetLatitudeE7':0,'targetLongitudeE7':-direction*1799990000});route['points']=[{'latitudeE7':0,'longitudeE7':direction*1799990000},{'latitudeE7':0,'longitudeE7':-direction*1799990000}];api.current=FoodNavigationSnapshot.fromJson({...json,'assignment':assignment,'route':route});
   await tester.pumpWidget(surface(api));await tester.pumpAndSettle();
   final driver=find.byIcon(Icons.delivery_dining),target=find.byIcon(Icons.flag);
   final before=tester.getCenter(target)-tester.getCenter(driver);expect(before.dx*direction,closeTo(23.3016889,.01));expect(before.dy,closeTo(0,.01));expect(tester.getRect(find.byType(InteractiveViewer)).contains(tester.getCenter(target)),isTrue);
   await tester.tap(find.byTooltip('Zoom in'));await tester.pumpAndSettle();
   final from=tester.getCenter(driver),to=tester.getCenter(target);expect((to.dx-from.dx)*direction,closeTo(46.6033778,.01));expect(tester.getRect(find.byType(InteractiveViewer)).contains(to),isTrue);
   final boundary=tester.renderObject<RenderRepaintBoundary>(find.byKey(const ValueKey('navigation-pixels'))),origin=tester.getTopLeft(find.byKey(const ValueKey('navigation-pixels'))),mid=(from+to)/2-origin;
   final expected=Theme.of(tester.element(driver)).colorScheme.primary;late ui.Image image;late ByteData bytes;
   await tester.runAsync(() async{image=await boundary.toImage(pixelRatio:1);bytes=(await image.toByteData(format:ui.ImageByteFormat.rawRgba))!;});
   final index=(mid.dy.round()*image.width+mid.dx.round())*4;expect(bytes.getUint8(index),(expected.r*255).round());expect(bytes.getUint8(index+1),(expected.g*255).round());expect(bytes.getUint8(index+2),(expected.b*255).round());image.dispose();expect(tester.takeException(),isNull);
  });
 }
}
