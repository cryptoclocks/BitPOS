import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_shared/mobile_v1.generated.dart';
import 'package:mobile_shared/settlement_beneficiary_mutation.dart';
import 'package:bitpos_driver/payout_beneficiary_page.dart';
import 'driver_earnings_surface_test.dart' show EarningsApi, page, first, second;

class BeneficiaryApi extends EarningsApi {
 @override Future<SettlementBeneficiaryMutation?> pendingSettlementBeneficiary()async=>null;
}
void main(){
 testWidgets('clipboard failure exposes manual recovery without an unhandled platform exception',(tester)async{
  final api=BeneficiaryApi();addTearDown(api.close);
  tester.view.physicalSize=const Size(800,3000);tester.view.devicePixelRatio=1;
  addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
  final c=SettlementOwnershipChallenge(version:1,domain:'bitpos.driver-settlement.v1',tenantId:first,accountId:first,deviceId:first,enrollmentId:first,challengeId:first,nonce:'a'*64,destinationOwner:'1'*32,genesisHash:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',issuedAt:'2026-10-19T01:00:00Z',expiresAt:'2026-10-19T02:00:00Z');
  final data=page().toJson();data['beneficiaries']=[SettlementBeneficiarySummary(beneficiaryId:first,merchantId:first,provider:'solana-devnet',state:'PENDING',version:'1',challenge:c).toJson()];api.current=SettlementDriverPage.fromJson(data);
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform,(call)async{if(call.method=='Clipboard.setData')throw PlatformException(code:'clipboard_unavailable');return null;});
  addTearDown(()=>tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform,null));
  await tester.pumpWidget(MaterialApp(home:PayoutBeneficiaryPage(api:api,thai:false)));await tester.pumpAndSettle();
  await tester.tap(find.text('PENDING · $first'));await tester.pumpAndSettle();
  await tester.ensureVisible(find.text('Copy exact signing message'));await tester.tap(find.text('Copy exact signing message'));await tester.pumpAndSettle();
  expect(tester.takeException(),isNull);expect(find.textContaining('Could not copy.'),findsOneWidget);expect(find.byType(SelectableText),findsOneWidget);
 });

 testWidgets('account retirement clears typed destination and ignores delayed reload',(tester)async{
  final api=BeneficiaryApi();addTearDown(api.close);
  tester.view.physicalSize=const Size(800,2600);tester.view.devicePixelRatio=1;
  addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(home:PayoutBeneficiaryPage(api:api,thai:false)));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField).at(0),first);
  await tester.enterText(find.byType(TextField).at(1),'private-destination-fixture');
  api.pending=Completer<SettlementDriverPage>();
  await tester.tap(find.text('Reload facts and saved command'));await tester.pump();
  api.change((accountId:second,sessionId:second));await tester.pump();
  expect(find.text('Session changed; private facts hidden.'),findsOneWidget);
  expect(find.byType(TextField),findsNothing);
  api.pending!.complete(page());await tester.pumpAndSettle();
  expect(find.byType(TextField),findsNothing);
  expect(find.text('private-destination-fixture'),findsNothing);
  expect(tester.takeException(),isNull);
 });
 testWidgets('background hides destination and reload restores facts without restoring draft',(tester)async{
  final api=BeneficiaryApi();addTearDown(api.close);
  tester.view.physicalSize=const Size(800,2600);tester.view.devicePixelRatio=1;
  addTearDown(tester.view.resetPhysicalSize);addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(MaterialApp(home:PayoutBeneficiaryPage(api:api,thai:false)));await tester.pumpAndSettle();
  await tester.enterText(find.byType(TextField).at(1),'private-destination-fixture');
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);await tester.pump();
  expect(find.byType(TextField),findsNothing);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);await tester.pumpAndSettle();
  expect(find.byType(TextField),findsNWidgets(2));
  expect(find.text('private-destination-fixture'),findsNothing);
 });
}
