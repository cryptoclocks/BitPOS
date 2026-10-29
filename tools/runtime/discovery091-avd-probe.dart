import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:mobile_shared/mobile_api.dart';
import 'package:mobile_shared/bitpos_theme.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:bitpos_customer/food_page.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';

class ObservedDiscoveryApi extends MobileApi {
 ObservedDiscoveryApi():super(base:Uri.parse('http://10.0.2.2:__DISCOVERY091_PORT__/api/mobile/v1/'),fixture:true);
 @override Future<MobileBranches> branches({String? cursor,String search='',String serving='all'}) async {
  debugPrint('DISCOVERY091_REQUEST search=$search serving=$serving cursor=$cursor');
  try {final result=await super.branches(cursor:cursor,search:search,serving:serving);debugPrint('DISCOVERY091_RESPONSE rows=${result.branches.length} cursor=${result.nextCursor}');return result;}
  catch(error){debugPrint('DISCOVERY091_ERROR $error');rethrow;}
 }
}

// Copied temporarily by discovery091-http-avd-smoke.ts, never shipped in app.
void main() {
 IntegrationTestWidgetsFlutterBinding.ensureInitialized();
 testWidgets('Actual filtered discovery and stale-result removal', (tester) async {
  const needle='__DISCOVERY091_NEEDLE__';
  FlutterSecureStorage.setMockInitialValues({});
  final api=ObservedDiscoveryApi();
  addTearDown(() async {if(api.signedIn)await api.logout();api.close();});
  await tester.runAsync(()=>api.restore());
  await tester.runAsync(()=>api.verifyOtp('+66900000001','123456'));
  await tester.pumpWidget(MaterialApp(theme:BitPosTheme.light(),home:Scaffold(body:SafeArea(child:ListView(padding:const EdgeInsets.fromLTRB(24,8,24,24),children:[FoodPage(api:api,thai:false,onAuthenticationRequired:()=>fail('Synthetic fixture session unexpectedly rejected'))])))));
  Future<void> waitFor(Finder finder) async {
   final end=DateTime.now().add(const Duration(seconds:30));
   while(finder.evaluate().isEmpty&&DateTime.now().isBefore(end)){await tester.pump(const Duration(milliseconds:100));}
   expect(finder,findsOneWidget);
  }
  final search=find.byKey(const ValueKey('branch-discovery-search'));
  await waitFor(search);
  final ready=DateTime.now().add(const Duration(seconds:30));
  while(tester.widget<TextField>(search).enabled==false&&DateTime.now().isBefore(ready)){await tester.pump(const Duration(milliseconds:100));}
  expect(tester.widget<TextField>(search).enabled,true);
  await tester.enterText(search,needle);
  final delivery=find.byKey(const ValueKey('branch-mode-delivery'));
  await tester.ensureVisible(delivery);await tester.tap(delivery);await tester.pump();
  await waitFor(find.text('$needle Branch32'));
  expect(find.text('$needle Branch33'),findsNothing);expect(find.text('$needle Branch0'),findsNothing);
  debugPrint('BITPOS_DISCOVERY091_DELIVERY_VISIBLE');
  await tester.runAsync(()=>Future<void>.delayed(const Duration(seconds:2)));
  await tester.pumpAndSettle();
  debugPrint('DISCOVERY091_SECOND_INPUT enabled=${tester.widget<TextField>(search).enabled} loading=${find.byType(LinearProgressIndicator).evaluate().length}');
  expect(tester.widget<TextField>(search).enabled,true);
  FocusManager.instance.primaryFocus?.unfocus();await tester.pump();
  await tester.ensureVisible(search);await tester.tap(search);await tester.pump();
  await tester.enterText(search,'${needle}missing');await tester.pump();
  expect(tester.widget<TextField>(search).controller!.text,'${needle}missing');
  FocusManager.instance.primaryFocus?.unfocus();await tester.pumpAndSettle();
  final submit=find.byKey(const ValueKey('branch-discovery-submit'));
  expect(tester.widget<FilledButton>(submit).onPressed,isNotNull,reason:'Search must be enabled before dispatching the second query');
  await tester.ensureVisible(submit);await tester.tap(submit);await tester.pump();
  await waitFor(find.text('No merchants match this search.'));expect(find.text('$needle Branch32'),findsNothing);
 });
}
